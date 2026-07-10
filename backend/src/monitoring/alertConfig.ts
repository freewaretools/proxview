import { getSetting, setSetting } from '../db/index.js';

export type AlertType =
  | 'site-unreachable'
  | 'no-quorum'
  | 'node-offline'
  | 'node-memory'
  | 'node-cpu'
  | 'node-temp'
  | 'node-power'
  | 'pbs-unreachable'
  | 'datastore-full'
  | 'backups-idle'
  | 'gc-failed'
  | 'verify-failed';

export interface AlertRule {
  enabled: boolean;
  level: 'warn' | 'crit';
  threshold: number; // unit depends on the rule; ignored for non-threshold rules
}

export interface AlertConfig {
  rules: Record<AlertType, AlertRule>;
  notifyOnResolve: boolean;
  confirmPolls: number; // consecutive polls a condition must hold before notifying (1..10)
  reminderMinutes: number; // re-notify cadence while still active; 0 = off
  metricsIntervalMs: number; // PVE/PBS metrics poll cadence
  tempsIntervalMs: number; // SSH temperature/power poll cadence
}

/** Static metadata for the UI — labels, units, and whether a rule takes a threshold. */
export const ALERT_META: Record<AlertType, { label: string; unit?: string; group: 'pve' | 'pbs' }> = {
  'site-unreachable': { label: 'Proxmox site unreachable', group: 'pve' },
  'no-quorum': { label: 'Cluster lost quorum', group: 'pve' },
  'node-offline': { label: 'Node offline', group: 'pve' },
  'node-memory': { label: 'Node memory usage', unit: '%', group: 'pve' },
  'node-cpu': { label: 'Node CPU usage', unit: '%', group: 'pve' },
  'node-temp': { label: 'Node CPU temperature', unit: '°C', group: 'pve' },
  'node-power': { label: 'Node power draw', unit: 'W', group: 'pve' },
  'pbs-unreachable': { label: 'PBS unreachable', group: 'pbs' },
  'datastore-full': { label: 'Datastore fullness', unit: '%', group: 'pbs' },
  'backups-idle': { label: 'No recent backups', unit: 'days', group: 'pbs' },
  'gc-failed': { label: 'Garbage collection failed', group: 'pbs' },
  'verify-failed': { label: 'Verification failed', group: 'pbs' },
};

/** Rules whose `threshold` is meaningful (the rest are boolean conditions). */
export const THRESHOLD_RULES = new Set<AlertType>([
  'node-memory',
  'node-cpu',
  'node-temp',
  'node-power',
  'datastore-full',
  'backups-idle',
]);

const DEFAULTS: AlertConfig = {
  rules: {
    'site-unreachable': { enabled: true, level: 'crit', threshold: 0 },
    'no-quorum': { enabled: true, level: 'warn', threshold: 0 },
    'node-offline': { enabled: true, level: 'crit', threshold: 0 },
    'node-memory': { enabled: true, level: 'warn', threshold: 92 },
    'node-cpu': { enabled: false, level: 'warn', threshold: 90 },
    'node-temp': { enabled: true, level: 'crit', threshold: 85 },
    'node-power': { enabled: false, level: 'warn', threshold: 250 },
    'pbs-unreachable': { enabled: true, level: 'crit', threshold: 0 },
    'datastore-full': { enabled: true, level: 'crit', threshold: 90 },
    'backups-idle': { enabled: true, level: 'warn', threshold: 2 },
    'gc-failed': { enabled: true, level: 'crit', threshold: 0 },
    'verify-failed': { enabled: true, level: 'crit', threshold: 0 },
  },
  notifyOnResolve: true,
  confirmPolls: 2,
  reminderMinutes: 0,
  // Seed from the legacy env vars so existing deploys keep their cadence until changed.
  metricsIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 10_000,
  tempsIntervalMs: Number(process.env.TEMP_INTERVAL_MS) || 45_000,
};

const KEY = 'alert_config';

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/** Merge a (possibly partial/old) config with defaults, validating/clamping numbers. */
function normalize(p: Partial<AlertConfig>): AlertConfig {
  const rules = {} as Record<AlertType, AlertRule>;
  for (const key of Object.keys(DEFAULTS.rules) as AlertType[]) {
    const d = DEFAULTS.rules[key];
    const r: Partial<AlertRule> = p.rules?.[key] ?? {};
    rules[key] = {
      enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
      level: r.level === 'crit' || r.level === 'warn' ? r.level : d.level,
      threshold: clamp(r.threshold, 0, 100_000, d.threshold),
    };
  }
  return {
    rules,
    notifyOnResolve: typeof p.notifyOnResolve === 'boolean' ? p.notifyOnResolve : DEFAULTS.notifyOnResolve,
    confirmPolls: clamp(p.confirmPolls, 1, 10, DEFAULTS.confirmPolls),
    reminderMinutes: clamp(p.reminderMinutes, 0, 1440, DEFAULTS.reminderMinutes),
    metricsIntervalMs: clamp(p.metricsIntervalMs, 5_000, 600_000, DEFAULTS.metricsIntervalMs),
    tempsIntervalMs: clamp(p.tempsIntervalMs, 15_000, 600_000, DEFAULTS.tempsIntervalMs),
  };
}

export function getAlertConfig(): AlertConfig {
  const raw = getSetting(KEY);
  if (!raw) return normalize({});
  try {
    return normalize(JSON.parse(raw) as Partial<AlertConfig>);
  } catch {
    return normalize({});
  }
}

export function setAlertConfig(cfg: Partial<AlertConfig>): AlertConfig {
  const merged = normalize(cfg);
  setSetting(KEY, JSON.stringify(merged));
  return merged;
}
