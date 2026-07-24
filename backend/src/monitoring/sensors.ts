import { Client } from 'ssh2';
import type { GpuInfo, NodeTemps, TempReading } from './types.js';

export interface SshTarget {
  host: string;
  port: number;
  user: string;
  privateKey: string;
}

const MARKER = '===PVSENSORS===';

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

/** First `tempN_input` value in a sensor object whose name matches `pred`. */
function findTemp(chip: Record<string, unknown>, pred: (name: string) => boolean): number | undefined {
  for (const [name, val] of Object.entries(chip)) {
    if (name === 'Adapter' || !isObj(val) || !pred(name)) continue;
    const key = Object.keys(val).find((k) => /^temp\d+_input$/.test(k));
    if (key) {
      const n = Number(val[key]);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function maxCoreTemp(chip: Record<string, unknown>): number | undefined {
  const cores: number[] = [];
  for (const [name, val] of Object.entries(chip)) {
    if (!/^core /i.test(name) || !isObj(val)) continue;
    const key = Object.keys(val).find((k) => /^temp\d+_input$/.test(k));
    if (key) {
      const n = Number(val[key]);
      if (Number.isFinite(n)) cores.push(n);
    }
  }
  return cores.length ? Math.max(...cores) : undefined;
}

/** Turn `sensors -j` JSON into a normalised NodeTemps (CPU package + drive temps). */
export function parseSensors(raw: Record<string, unknown>): NodeTemps {
  const readings: TempReading[] = [];
  let cpu: number | undefined;
  let nvmeCount = 0;

  for (const [chip, chipVal] of Object.entries(raw ?? {})) {
    if (!isObj(chipVal)) continue;
    const cl = chip.toLowerCase();

    if (cl.startsWith('coretemp') || cl.startsWith('k10temp') || cl.startsWith('zenpower')) {
      const pkg =
        findTemp(chipVal, (s) => /package id 0|tctl|tdie/i.test(s)) ?? maxCoreTemp(chipVal);
      if (pkg !== undefined) cpu = cpu === undefined ? pkg : Math.max(cpu, pkg);
    } else if (cl.startsWith('nvme')) {
      const t = findTemp(chipVal, (s) => /composite/i.test(s)) ?? findTemp(chipVal, () => true);
      if (t !== undefined) {
        nvmeCount += 1;
        readings.push({ label: nvmeCount > 1 ? `NVMe ${nvmeCount}` : 'NVMe', value: t, kind: 'nvme' });
      }
    } else if (cl.startsWith('drivetemp')) {
      const t = findTemp(chipVal, () => true);
      if (t !== undefined) readings.push({ label: 'Drive', value: t, kind: 'drive' });
    }
  }

  if (cpu !== undefined) readings.unshift({ label: 'CPU', value: cpu, kind: 'cpu' });
  return { cpu, readings };
}

const WATTS_MARKER = '===PVWATTS===';
const IPMI_MARKER = '===PVIPMI===';
const GPU_MARKER = '===PVGPU===';
const NVIDIA_MARKER = '===PVNVIDIA===';
const ROCM_MARKER = '===PVROCM===';

// Sum the top-level RAPL package domains (skip :N:M subzones) into $w.
const RAPL_SUM =
  'w=0; for f in /sys/class/powercap/intel-rapl:*/energy_uj; do case "$f" in *:*:*) continue;; esac; [ -r "$f" ] && w=$((w+$(cat "$f" 2>/dev/null||echo 0))); done; echo $w';

// Whole-system watts from a BMC, if ipmitool + IPMI are present.
const IPMI_READ =
  "command -v ipmitool >/dev/null 2>&1 && ipmitool dcmi power reading 2>/dev/null | grep -i instantaneous | grep -oE '[0-9]+' | head -1 || echo";

// GPU controller names (iGPU + dGPU) straight from PCI IDs — works even without vendor tooling.
const LSPCI_GPU =
  "command -v lspci >/dev/null 2>&1 && lspci -mm 2>/dev/null | grep -Ei '\"(VGA compatible controller|3D controller)\"' || true";

// NVIDIA dGPU stats, one CSV line per card.
const NVIDIA_GPU =
  'command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi --query-gpu=name,temperature.gpu,power.draw,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null || true';

// AMD dGPU stats via rocm-smi. Output columns vary across ROCm versions, so this is parsed
// defensively from the CSV header rather than assumed to be in a fixed order.
const ROCM_GPU =
  'command -v rocm-smi >/dev/null 2>&1 && rocm-smi --showtemp --showpower --showuse --showproductname --csv 2>/dev/null || true';

export interface SensorReading {
  hostname: string;
  temps: NodeTemps;
  watts?: number; // CPU package power via RAPL
  systemWatts?: number; // whole-system power via IPMI DCMI
  gpus: GpuInfo[];
}

/** Parse `lspci -mm` lines for VGA/3D controllers into {vendor, device} pairs. */
function parseLspciGpus(raw: string): { vendor: string; device: string }[] {
  const out: { vendor: string; device: string }[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const fields = [...line.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!.replace(/\\"/g, '"'));
    // lspci -mm quotes everything but Slot and Rev: quoted fields are [Class, Vendor, Device, SVendor, SDevice].
    if (fields.length >= 3) out.push({ vendor: fields[1]!, device: fields[2]! });
  }
  return out;
}

function gpuVendorOf(pciVendor: string): GpuInfo['vendor'] {
  if (/nvidia/i.test(pciVendor)) return 'nvidia';
  if (/amd|ati|advanced micro/i.test(pciVendor)) return 'amd';
  if (/intel/i.test(pciVendor)) return 'intel';
  return 'other';
}

/** `nvidia-smi --query-gpu=... --format=csv,noheader,nounits` — one line per GPU. */
function parseNvidiaSmi(raw: string): GpuInfo[] {
  const gpus: GpuInfo[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split(',').map((s) => s.trim());
    if (parts.length < 6) continue;
    const [name, temp, power, util, memUsed, memTotal] = parts;
    const num = (s: string | undefined) => (s !== undefined && Number.isFinite(Number(s)) ? Number(s) : undefined);
    const mib = (s: string | undefined) => {
      const n = num(s);
      return n === undefined ? undefined : n * 1024 * 1024;
    };
    gpus.push({
      name: name || 'NVIDIA GPU',
      vendor: 'nvidia',
      temp: num(temp),
      power: num(power),
      util: num(util) !== undefined ? num(util)! / 100 : undefined,
      memUsed: mib(memUsed),
      memTotal: mib(memTotal),
    });
  }
  return gpus;
}

/** `rocm-smi --showtemp --showpower --showuse --showproductname --csv` — header-driven, best-effort. */
function parseRocmSmi(raw: string): GpuInfo[] {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const strip = (s: string) => s.trim().replace(/^"|"$/g, '');
  const header = lines[0]!.split(',').map(strip);
  const colIdx = (pred: RegExp) => header.findIndex((h) => pred.test(h));
  const tempIdx = colIdx(/temperature/i);
  const powerIdx = colIdx(/power/i);
  const useIdx = colIdx(/gpu use/i);
  const nameIdx = colIdx(/card model|card series/i);

  const gpus: GpuInfo[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',').map(strip);
    const temp = tempIdx >= 0 ? Number(cols[tempIdx]) : NaN;
    const power = powerIdx >= 0 ? Number(cols[powerIdx]) : NaN;
    const use = useIdx >= 0 ? Number(cols[useIdx]) : NaN;
    gpus.push({
      name: (nameIdx >= 0 && cols[nameIdx]) || 'AMD GPU',
      vendor: 'amd',
      temp: Number.isFinite(temp) ? temp : undefined,
      power: Number.isFinite(power) ? power : undefined,
      util: Number.isFinite(use) ? use / 100 : undefined,
    });
  }
  return gpus;
}

/** Merge PCI-discovered controllers (names, incl. iGPU) with vendor-tool stats (temp/power/util). */
function buildGpus(lspciRaw: string, nvidiaRaw: string, rocmRaw: string): GpuInfo[] {
  const pci = parseLspciGpus(lspciRaw);
  const nvidia = parseNvidiaSmi(nvidiaRaw);
  const amd = parseRocmSmi(rocmRaw);
  const gpus: GpuInfo[] = [];
  let nvIdx = 0;
  let amdIdx = 0;

  for (const p of pci) {
    const vendor = gpuVendorOf(p.vendor);
    if (vendor === 'nvidia' && nvIdx < nvidia.length) {
      gpus.push({ ...nvidia[nvIdx]!, name: p.device || nvidia[nvIdx]!.name });
      nvIdx += 1;
    } else if (vendor === 'amd' && amdIdx < amd.length) {
      gpus.push({ ...amd[amdIdx]!, name: p.device || amd[amdIdx]!.name });
      amdIdx += 1;
    } else {
      gpus.push({ name: p.device, vendor }); // e.g. Intel iGPU: name only, no temp/power probe
    }
  }
  // Vendor-tool entries lspci didn't surface a matching PCI line for still get reported.
  while (nvIdx < nvidia.length) gpus.push(nvidia[nvIdx++]!);
  while (amdIdx < amd.length) gpus.push(amd[amdIdx++]!);
  return gpus;
}

/** SSH to a node: short hostname + parsed temps + CPU package watts (RAPL, 1s sample). */
export function fetchNodeTemps(t: SshTarget): Promise<SensorReading> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let out = '';
    let settled = false;
    const finish = (err?: Error, val?: SensorReading) => {
      if (settled) return;
      settled = true;
      try {
        conn.end();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve(val!);
    };

    const cmd = [
      'hostname',
      `echo '${MARKER}'`,
      'sensors -j 2>/dev/null || echo "{}"',
      `echo '${WATTS_MARKER}'`,
      RAPL_SUM,
      'sleep 1',
      RAPL_SUM,
      `echo '${IPMI_MARKER}'`,
      IPMI_READ,
      `echo '${GPU_MARKER}'`,
      LSPCI_GPU,
      `echo '${NVIDIA_MARKER}'`,
      NVIDIA_GPU,
      `echo '${ROCM_MARKER}'`,
      ROCM_GPU,
    ].join('\n');

    conn
      .on('ready', () => {
        conn.exec(cmd, (err, stream) => {
          if (err) return finish(err);
          stream
            .on('close', () => {
              const sIdx = out.indexOf(MARKER);
              const wIdx = out.indexOf(WATTS_MARKER);
              const hostname = (sIdx >= 0 ? out.slice(0, sIdx) : '')
                .trim()
                .split('\n')[0]
                ?.trim()
                .split('.')[0] ?? '';
              const jsonPart = out.slice(
                sIdx >= 0 ? sIdx + MARKER.length : 0,
                wIdx >= 0 ? wIdx : undefined,
              );
              let temps: NodeTemps = { readings: [] };
              try {
                temps = parseSensors(JSON.parse(jsonPart.trim()) as Record<string, unknown>);
              } catch {
                /* lm-sensors not installed / no JSON */
              }
              const iIdx = out.indexOf(IPMI_MARKER);
              let watts: number | undefined;
              if (wIdx >= 0) {
                const nums = out
                  .slice(wIdx + WATTS_MARKER.length, iIdx >= 0 ? iIdx : undefined)
                  .trim()
                  .split(/\s+/)
                  .map(Number)
                  .filter((n) => Number.isFinite(n));
                if (nums.length >= 2 && nums[0]! > 0 && nums[1]! > 0) {
                  const delta = nums[1]! - nums[0]!; // microjoules over ~1s
                  if (delta > 0 && delta < 1e12) watts = Math.round(delta / 1e6);
                }
              }
              let systemWatts: number | undefined;
              const gIdx = out.indexOf(GPU_MARKER);
              if (iIdx >= 0) {
                const n = Number(
                  out.slice(iIdx + IPMI_MARKER.length, gIdx >= 0 ? gIdx : undefined).trim().split(/\s+/)[0],
                );
                if (Number.isFinite(n) && n > 0) systemWatts = Math.round(n);
              }

              let gpus: GpuInfo[] = [];
              const nIdx = out.indexOf(NVIDIA_MARKER);
              const rIdx = out.indexOf(ROCM_MARKER);
              try {
                const lspciRaw = gIdx >= 0 ? out.slice(gIdx + GPU_MARKER.length, nIdx >= 0 ? nIdx : undefined) : '';
                const nvidiaRaw = nIdx >= 0 ? out.slice(nIdx + NVIDIA_MARKER.length, rIdx >= 0 ? rIdx : undefined) : '';
                const rocmRaw = rIdx >= 0 ? out.slice(rIdx + ROCM_MARKER.length) : '';
                gpus = buildGpus(lspciRaw, nvidiaRaw, rocmRaw);
              } catch {
                /* GPU tooling not present / unparsable output */
              }

              finish(undefined, { hostname, temps, watts, systemWatts, gpus });
            })
            .on('data', (d: Buffer) => {
              out += d.toString();
            });
          stream.stderr.on('data', () => undefined);
        });
      })
      .on('error', (e) => finish(e))
      .connect({
        host: t.host,
        port: t.port,
        username: t.user,
        privateKey: t.privateKey,
        readyTimeout: 9000,
      });
  });
}
