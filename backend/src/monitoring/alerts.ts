import { type AlertConfig, type AlertType, getAlertConfig } from './alertConfig.js';
import type { PbsSnapshot, SiteSnapshot } from './types.js';

export interface Alert {
  key: string; // stable identity, used for dedup
  level: 'warn' | 'crit';
  title: string; // short, shown as a banner chip
  body: string; // longer, used in notifications
}

/**
 * Derive the current alert set from live snapshots, honouring the per-rule config
 * (enable/disable, thresholds, severity). Keys are stable per condition so the
 * notifier can debounce and resolve them. Single source of truth for both the
 * on-screen banner and notifications.
 */
export function computeAlerts(
  sites: SiteSnapshot[],
  pbs: PbsSnapshot[],
  config: AlertConfig = getAlertConfig(),
): Alert[] {
  const alerts: Alert[] = [];
  const R = config.rules;
  const on = (t: AlertType): boolean => R[t].enabled;
  const lvl = (t: AlertType): 'warn' | 'crit' => R[t].level;
  const thr = (t: AlertType): number => R[t].threshold;

  for (const s of sites) {
    if (!s.reachable) {
      if (on('site-unreachable'))
        alerts.push({
          key: `site-down:${s.siteId}`,
          level: lvl('site-unreachable'),
          title: `${s.name} unreachable`,
          body: s.error ?? 'The Proxmox API could not be reached.',
        });
      continue;
    }
    if (s.quorate === false && on('no-quorum'))
      alerts.push({
        key: `no-quorum:${s.siteId}`,
        level: lvl('no-quorum'),
        title: `${s.name}: no quorum`,
        body: 'The cluster has lost quorum.',
      });

    for (const n of s.nodes) {
      if (n.status === 'offline') {
        if (on('node-offline'))
          alerts.push({
            key: `node-down:${s.siteId}:${n.node}`,
            level: lvl('node-offline'),
            title: `Node ${n.node} offline`,
            body: `${n.node} on ${s.name} is offline.`,
          });
        continue;
      }
      if (on('node-memory')) {
        const pct = n.maxmem ? (n.mem / n.maxmem) * 100 : 0;
        if (pct >= thr('node-memory'))
          alerts.push({
            key: `node-mem:${s.siteId}:${n.node}`,
            level: lvl('node-memory'),
            title: `${n.node} memory ${Math.round(pct)}%`,
            body: `Memory usage on ${n.node} (${s.name}) is ${Math.round(pct)}%.`,
          });
      }
      if (on('node-cpu')) {
        const pct = (n.cpu ?? 0) * 100;
        if (pct >= thr('node-cpu'))
          alerts.push({
            key: `node-cpu:${s.siteId}:${n.node}`,
            level: lvl('node-cpu'),
            title: `${n.node} CPU ${Math.round(pct)}%`,
            body: `CPU usage on ${n.node} (${s.name}) is ${Math.round(pct)}%.`,
          });
      }
      if (on('node-temp') && n.temps?.cpu != null && n.temps.cpu >= thr('node-temp'))
        alerts.push({
          key: `node-temp:${s.siteId}:${n.node}`,
          level: lvl('node-temp'),
          title: `${n.node} CPU ${Math.round(n.temps.cpu)}°C`,
          body: `CPU temperature on ${n.node} (${s.name}) is ${Math.round(n.temps.cpu)}°C.`,
        });
      if (on('node-power') && n.power != null && n.power > 0 && n.power >= thr('node-power'))
        alerts.push({
          key: `node-power:${s.siteId}:${n.node}`,
          level: lvl('node-power'),
          title: `${n.node} ${Math.round(n.power)} W`,
          body: `Power draw on ${n.node} (${s.name}) is ${Math.round(n.power)} W.`,
        });
    }
  }

  for (const p of pbs) {
    if (!p.reachable) {
      if (on('pbs-unreachable'))
        alerts.push({
          key: `pbs-down:${p.siteId}`,
          level: lvl('pbs-unreachable'),
          title: `${p.name} unreachable`,
          body: p.error ?? 'The PBS API could not be reached.',
        });
      continue;
    }
    if (on('datastore-full'))
      for (const d of p.datastores) {
        if (d.usedPct >= thr('datastore-full'))
          alerts.push({
            key: `ds-full:${p.siteId}:${d.store}`,
            level: lvl('datastore-full'),
            title: `${d.store} ${Math.round(d.usedPct)}% full`,
            body: `Datastore ${d.store} on ${p.name} is ${Math.round(d.usedPct)}% full.`,
          });
      }
    // One signal per server: has it received ANY backup recently? Avoids noise from
    // intentionally-old archive namespaces and per-source retention.
    if (on('backups-idle') && p.groups.length) {
      const freshest = Math.max(...p.groups.map((g) => g.lastBackup));
      const ageDays = (Date.now() / 1000 - freshest) / 86400;
      if (ageDays > thr('backups-idle'))
        alerts.push({
          key: `backups-idle:${p.siteId}`,
          level: lvl('backups-idle'),
          title: `${p.name}: no backups in ${Math.round(ageDays)}d`,
          body: `The most recent backup on ${p.name} is ${Math.round(ageDays)} days old.`,
        });
    }
    if (on('gc-failed') && p.gc?.status === 'failed')
      alerts.push({
        key: `gc-failed:${p.siteId}`,
        level: lvl('gc-failed'),
        title: `${p.name} garbage collection failed`,
        body: 'The last GC task on the backup server failed.',
      });
    if (on('verify-failed') && p.verify?.status === 'failed')
      alerts.push({
        key: `verify-failed:${p.siteId}`,
        level: lvl('verify-failed'),
        title: `${p.name} verification failed`,
        body: 'The last verify task on the backup server failed.',
      });
  }

  return alerts;
}
