import { env } from '../config/env.js';
import { listSshTargets } from '../sites/repo.js';
import { getAlertConfig } from './alertConfig.js';
import { fetchNodeTemps } from './sensors.js';
import { recordGpuTemp, recordGpuWatts, recordSystemWatts, recordTemp, recordWatts } from './timeseries.js';
import type { GpuInfo, NodeTemps } from './types.js';

interface Reading {
  temps: NodeTemps;
  watts?: number;
  systemWatts?: number;
  gpus?: GpuInfo[];
}

// siteId -> node name -> latest reading
const cache = new Map<string, Map<string, Reading>>();
let logger: { error: (msg: string) => void } = { error: () => undefined };

export function getNodeTemps(siteId: string, node: string): NodeTemps | undefined {
  return cache.get(siteId)?.get(node)?.temps;
}
export function getNodeWatts(siteId: string, node: string): number | undefined {
  return cache.get(siteId)?.get(node)?.watts;
}
export function getNodeSystemWatts(siteId: string, node: string): number | undefined {
  return cache.get(siteId)?.get(node)?.systemWatts;
}
export function getNodeGpus(siteId: string, node: string): GpuInfo[] | undefined {
  return cache.get(siteId)?.get(node)?.gpus;
}

/** Any reading for a site — used for single-host sites (PBS). */
function firstReading(siteId: string): Reading | undefined {
  const first = cache.get(siteId)?.values().next();
  return first && !first.done ? first.value : undefined;
}
export function getSiteTemps(siteId: string): NodeTemps | undefined {
  return firstReading(siteId)?.temps;
}
export function getSiteWatts(siteId: string): number | undefined {
  return firstReading(siteId)?.watts;
}
export function getSiteSystemWatts(siteId: string): number | undefined {
  return firstReading(siteId)?.systemWatts;
}
export function getSiteGpus(siteId: string): GpuInfo[] | undefined {
  return firstReading(siteId)?.gpus;
}

async function pollTemps(): Promise<void> {
  for (const target of listSshTargets()) {
    try {
      const { hostname, temps, watts, systemWatts, gpus } = await fetchNodeTemps(target);
      if (!hostname) continue;
      let siteMap = cache.get(target.siteId);
      if (!siteMap) {
        siteMap = new Map();
        cache.set(target.siteId, siteMap);
      }
      siteMap.set(hostname, { temps, watts, systemWatts, gpus });
      if (temps.cpu !== undefined) recordTemp(target.siteId, hostname, temps.cpu);
      if (watts !== undefined) recordWatts(target.siteId, hostname, watts);
      if (systemWatts !== undefined) recordSystemWatts(target.siteId, hostname, systemWatts);
      gpus?.forEach((g, i) => {
        if (g.temp !== undefined) recordGpuTemp(target.siteId, hostname, i, g.temp);
        if (g.power !== undefined) recordGpuWatts(target.siteId, hostname, i, g.power);
      });
    } catch (err) {
      logger.error(`temp poll failed for site ${target.siteId}: ${(err as Error).message}`);
    }
  }
}

export function startTempPoller(log?: { error: (msg: string) => void }): void {
  if (log) logger = log;
  if (env.demo) return; // demo temps/watts are synthetic (see demo.ts)
  // setTimeout loop (not setInterval) so cadence changes in Settings take effect live.
  const loop = async (): Promise<void> => {
    await pollTemps();
    const timer = setTimeout(() => void loop(), getAlertConfig().tempsIntervalMs);
    timer.unref?.();
  };
  void loop();
}
