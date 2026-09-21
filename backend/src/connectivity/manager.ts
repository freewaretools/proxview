import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '../config/env.js';
import { getConnectivity } from './store.js';
import { parseWireguardConfig, type WireguardSummary } from './wireguard.js';

/**
 * Supervises the optional remote-access tunnels (Cloudflare, Tailscale, WireGuard) in
 * the ProxView container, driven by the encrypted config in
 * the DB. This is what lets the setup wizards apply a token without the user
 * ever editing .env or running a compose command.
 */

interface Logger {
  info: (msg: string) => void;
  error: (msg: string) => void;
}
let log: Logger = { info: () => {}, error: () => {} };

type ServiceState = 'off' | 'starting' | 'running' | 'error';

interface Runner {
  proc: ChildProcess | null;
  state: ServiceState;
  detail?: string;
}

const cloudflare: Runner = { proc: null, state: 'off' };
const tailscale: Runner = { proc: null, state: 'off' };
const wireguard: { state: ServiceState; detail?: string; hash?: string } = { state: 'off' };

// Short, fixed interface name (Linux caps names at 15 chars).
const WG_IFACE = 'pvwg0';

const TS_STATE_DIR = join(env.dataDir, 'tailscale');
const TS_SOCK = join(TS_STATE_DIR, 'tailscaled.sock');

function binaryExists(bin: string): boolean {
  const r = spawnSync(bin, ['--version'], { stdio: 'ignore' });
  return !r.error;
}

// --- Cloudflare Tunnel -----------------------------------------------------

function stopCloudflare(): void {
  if (cloudflare.proc) {
    cloudflare.proc.removeAllListeners();
    cloudflare.proc.kill('SIGTERM');
    cloudflare.proc = null;
  }
  cloudflare.state = 'off';
  cloudflare.detail = undefined;
}

function startCloudflare(token: string): void {
  stopCloudflare();
  if (!binaryExists('cloudflared')) {
    cloudflare.state = 'error';
    cloudflare.detail = 'cloudflared binary not found — rebuild the ProxView image to enable this.';
    log.error('[connectivity] cloudflared binary missing');
    return;
  }
  cloudflare.state = 'starting';
  cloudflare.detail = undefined;
  const proc = spawn(
    'cloudflared',
    ['tunnel', '--no-autoupdate', 'run', '--token', token],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  cloudflare.proc = proc;
  proc.on('spawn', () => {
    cloudflare.state = 'running';
    log.info('[connectivity] cloudflared started');
  });
  const watch = (buf: Buffer): void => {
    const text = buf.toString();
    if (/Registered tunnel connection|Connection .* registered/i.test(text)) {
      cloudflare.state = 'running';
    }
    if (/\berror\b|failed to|unauthorized|invalid tunnel/i.test(text)) {
      cloudflare.detail = text.split('\n').find((l) => /error|failed|invalid|unauthorized/i.test(l))?.slice(0, 240);
    }
  };
  proc.stdout?.on('data', watch);
  proc.stderr?.on('data', watch);
  proc.on('exit', (code) => {
    if (cloudflare.proc === proc) {
      cloudflare.state = code === 0 ? 'off' : 'error';
      if (code) cloudflare.detail = cloudflare.detail ?? `cloudflared exited (code ${code}) — check the token.`;
      cloudflare.proc = null;
    }
  });
  proc.on('error', (err) => {
    cloudflare.state = 'error';
    cloudflare.detail = err.message;
  });
}

// --- Tailscale -------------------------------------------------------------

function ts(...args: string[]) {
  // encoding: 'utf8' → stdout/stderr are strings (not Buffers).
  return spawnSync('tailscale', ['--socket', TS_SOCK, ...args], { encoding: 'utf8' });
}

function stopTailscale(): void {
  if (tailscale.proc) {
    ts('down'); // best-effort; ignore result
    tailscale.proc.removeAllListeners();
    tailscale.proc.kill('SIGTERM');
    tailscale.proc = null;
  }
  tailscale.state = 'off';
  tailscale.detail = undefined;
}

function startTailscale(authKey: string, funnel: boolean): void {
  stopTailscale();
  if (!binaryExists('tailscaled')) {
    tailscale.state = 'error';
    tailscale.detail = 'tailscaled binary not found — rebuild the ProxView image to enable this.';
    log.error('[connectivity] tailscaled binary missing');
    return;
  }
  mkdirSync(TS_STATE_DIR, { recursive: true });
  tailscale.state = 'starting';
  tailscale.detail = undefined;

  // Userspace networking: no TUN device / NET_ADMIN needed inside the container.
  const proc = spawn(
    'tailscaled',
    [
      '--tun=userspace-networking',
      '--socket',
      TS_SOCK,
      '--state',
      join(TS_STATE_DIR, 'tailscaled.state'),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  tailscale.proc = proc;
  proc.on('error', (err) => {
    tailscale.state = 'error';
    tailscale.detail = err.message;
  });
  proc.on('exit', (code) => {
    if (tailscale.proc === proc) {
      tailscale.state = code === 0 ? 'off' : 'error';
      if (code) tailscale.detail = tailscale.detail ?? `tailscaled exited (code ${code}).`;
      tailscale.proc = null;
    }
  });

  // Bring the node up once the daemon's socket is ready, then publish ProxView.
  let attempts = 0;
  const bringUp = (): void => {
    if (tailscale.proc !== proc) return; // superseded/stopped
    const up = ts(
      'up',
      `--authkey=${authKey}`,
      '--hostname=proxview',
      '--accept-dns=false',
      '--reset',
    );
    if (up.status === 0) {
      ts('serve', '--bg', String(env.port));
      if (funnel) ts('funnel', '--bg', String(env.port));
      tailscale.state = 'running';
      tailscale.detail = tailnetUrl() ?? undefined;
      log.info('[connectivity] tailscale up');
      return;
    }
    if (++attempts < 15) {
      setTimeout(bringUp, 1000);
    } else {
      tailscale.state = 'error';
      tailscale.detail = (up.stderr || up.stdout || 'tailscale up failed').toString().split('\n')[0]?.slice(0, 240);
    }
  };
  setTimeout(bringUp, 800);
}

function tailnetUrl(): string | null {
  const r = ts('status', '--json');
  if (r.status !== 0 || !r.stdout) return null;
  try {
    const dns = (JSON.parse(r.stdout) as { Self?: { DNSName?: string } }).Self?.DNSName;
    return dns ? `https://${dns.replace(/\.$/, '')}` : null;
  } catch {
    return null;
  }
}

// --- WireGuard -------------------------------------------------------------

function wgInterfaceUp(): boolean {
  return spawnSync('wg', ['show', WG_IFACE], { stdio: 'ignore' }).status === 0;
}

function stopWireguard(): void {
  if (wgInterfaceUp()) spawnSync('ip', ['link', 'delete', WG_IFACE], { stdio: 'ignore' });
  wireguard.state = 'off';
  wireguard.detail = undefined;
  wireguard.hash = undefined;
}

/** Turn wg-quick's stderr into something a user can act on. */
function explainWgFailure(stderr: string): string {
  if (/operation not permitted|permission denied|rtnetlink/i.test(stderr)) {
    return 'The container needs the NET_ADMIN capability — recreate it with --cap-add NET_ADMIN (compose: cap_add: [NET_ADMIN]).';
  }
  if (/protocol not supported|unknown device type|module/i.test(stderr)) {
    return "The host kernel doesn't provide WireGuard (needs Linux 5.6+ or the wireguard module).";
  }
  const line = stderr
    .split('\n')
    .map((l) => l.replace(/^\[#\]\s*/, '').trim())
    .filter(Boolean)
    .pop();
  return (line ?? 'wg-quick failed').slice(0, 240);
}

function startWireguard(config: string): void {
  const hash = createHash('sha256').update(config).digest('hex');
  // Reconcile is called on every settings change — don't bounce a healthy tunnel.
  if (wireguard.hash === hash && wgInterfaceUp()) return;

  stopWireguard();
  if (!binaryExists('wg-quick')) {
    wireguard.state = 'error';
    wireguard.detail = 'wg-quick not found — update to the latest ProxView image to enable this.';
    log.error('[connectivity] wg-quick missing');
    return;
  }

  let parsed;
  try {
    parsed = parseWireguardConfig(config);
  } catch (err) {
    wireguard.state = 'error';
    wireguard.detail = (err as Error).message;
    return;
  }

  // The private key only touches a private temp dir, and only for the instant wg-quick reads it.
  const dir = mkdtempSync(join(tmpdir(), 'pvwg-'));
  const file = join(dir, `${WG_IFACE}.conf`);
  try {
    writeFileSync(file, parsed.sanitized, { mode: 0o600 });
    const up = spawnSync('wg-quick', ['up', file], { encoding: 'utf8', timeout: 20_000 });
    if (up.status !== 0) {
      wireguard.state = 'error';
      wireguard.detail = explainWgFailure(`${up.stderr ?? ''}${up.error ? String(up.error) : ''}`);
      log.error(`[connectivity] wireguard up failed: ${wireguard.detail}`);
      if (wgInterfaceUp()) spawnSync('ip', ['link', 'delete', WG_IFACE], { stdio: 'ignore' });
      return;
    }
    wireguard.state = 'running';
    wireguard.detail = undefined;
    wireguard.hash = hash;
    log.info('[connectivity] wireguard up');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Seconds since the most recent handshake with any peer, or null if none yet. */
function wgHandshakeAgeSec(): number | null {
  const r = spawnSync('wg', ['show', WG_IFACE, 'latest-handshakes'], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout) return null;
  const latest = Math.max(
    0,
    ...r.stdout
      .trim()
      .split('\n')
      .map((l) => Number(l.split(/\s+/)[1]) || 0),
  );
  return latest > 0 ? Math.max(0, Math.floor(Date.now() / 1000 - latest)) : null;
}

// --- Public API ------------------------------------------------------------

/** Reconcile running processes with the persisted config. Safe to call repeatedly. */
export function applyConnectivity(logger?: Logger): void {
  if (logger) log = logger;
  const cfg = getConnectivity();

  if (cfg.cloudflare.enabled && cfg.cloudflare.token) startCloudflare(cfg.cloudflare.token);
  else stopCloudflare();

  if (cfg.tailscale.enabled && cfg.tailscale.authKey) startTailscale(cfg.tailscale.authKey, cfg.tailscale.funnel);
  else stopTailscale();

  if (cfg.wireguard.enabled && cfg.wireguard.config) startWireguard(cfg.wireguard.config);
  else stopWireguard();
}

export interface ConnectivityStatus {
  cloudflare: { enabled: boolean; configured: boolean; state: ServiceState; detail?: string };
  tailscale: {
    enabled: boolean;
    configured: boolean;
    funnel: boolean;
    state: ServiceState;
    url?: string;
    detail?: string;
  };
  wireguard: {
    enabled: boolean;
    configured: boolean;
    state: ServiceState;
    detail?: string;
    summary?: WireguardSummary;
    /** Seconds since the last handshake; null until the first one completes. */
    handshakeAgeSec?: number | null;
  };
}

function wireguardSummary(config: string): WireguardSummary | undefined {
  if (!config) return undefined;
  try {
    return parseWireguardConfig(config).summary;
  } catch {
    return undefined;
  }
}

export function connectivityStatus(): ConnectivityStatus {
  const cfg = getConnectivity();
  return {
    cloudflare: {
      enabled: cfg.cloudflare.enabled,
      configured: Boolean(cfg.cloudflare.token),
      state: cloudflare.state,
      detail: cloudflare.detail,
    },
    tailscale: {
      enabled: cfg.tailscale.enabled,
      configured: Boolean(cfg.tailscale.authKey),
      funnel: cfg.tailscale.funnel,
      state: tailscale.state,
      url: tailscale.state === 'running' ? tailnetUrl() ?? tailscale.detail : undefined,
      detail: tailscale.detail,
    },
    wireguard: {
      enabled: cfg.wireguard.enabled,
      configured: Boolean(cfg.wireguard.config),
      state: wireguard.state,
      detail: wireguard.detail,
      summary: wireguardSummary(cfg.wireguard.config),
      handshakeAgeSec: wireguard.state === 'running' ? wgHandshakeAgeSec() : undefined,
    },
  };
}
