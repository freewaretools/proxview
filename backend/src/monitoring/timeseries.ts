import { getDb } from '../db/index.js';
import type { PbsSnapshot, SiteSnapshot } from './types.js';

const RETENTION_MS = Number(process.env.RETENTION_DAYS ?? 30) * 86_400_000;

export interface SeriesPoint {
  t: number; // epoch seconds
  v: number;
}

/** Series key helpers keep naming consistent between writer and reader. */
export function nodeSeriesKey(siteId: string, node: string, metric: string): string {
  return `${siteId}:node:${node}:${metric}`;
}

/** Per-guest series key. vmid is cluster-unique in PVE, so it needs no node segment. */
export function guestSeriesKey(siteId: string, vmid: number, metric: string): string {
  return `${siteId}:guest:${vmid}:${metric}`;
}

/** Persist node- and guest-level samples from a poll. Fraction metrics (cpu, mem) stored 0..1. */
export function recordSnapshot(snap: SiteSnapshot): void {
  if (!snap.reachable) return;
  const ts = Math.floor(snap.updatedAt / 1000);
  const rows: Array<[string, number, number]> = [];
  for (const n of snap.nodes) {
    if (n.status !== 'online') continue;
    rows.push([nodeSeriesKey(snap.siteId, n.node, 'cpu'), ts, n.cpu]);
    rows.push([nodeSeriesKey(snap.siteId, n.node, 'mem'), ts, n.maxmem ? n.mem / n.maxmem : 0]);
    for (const g of n.guests) {
      if (g.status !== 'running') continue;
      rows.push([guestSeriesKey(snap.siteId, g.vmid, 'cpu'), ts, g.cpu]);
      rows.push([guestSeriesKey(snap.siteId, g.vmid, 'mem'), ts, g.maxmem ? g.mem / g.maxmem : 0]);
    }
  }
  if (!rows.length) return;
  const stmt = getDb().prepare('INSERT INTO timeseries(series_key, ts, value) VALUES(?, ?, ?)');
  getDb().transaction(() => {
    for (const r of rows) stmt.run(r[0], r[1], r[2]);
  })();
}

/**
 * Persist a PBS server's host metrics from a poll. Stored under the node namespace
 * with a synthetic node name 'pbs' (the siteId is unique, so it can't collide with a
 * real PVE node) — this keeps the reader and the demo-series generator uniform.
 */
export function recordPbsSnapshot(snap: PbsSnapshot): void {
  if (!snap.reachable) return;
  const ts = Math.floor(Date.now() / 1000);
  const rows: Array<[string, number]> = [];
  if (snap.host) {
    rows.push([nodeSeriesKey(snap.siteId, 'pbs', 'cpu'), snap.host.cpu]);
    rows.push([
      nodeSeriesKey(snap.siteId, 'pbs', 'mem'),
      snap.host.maxmem ? snap.host.mem / snap.host.maxmem : 0,
    ]);
  }
  if (snap.temps?.cpu != null) rows.push([nodeSeriesKey(snap.siteId, 'pbs', 'temp'), snap.temps.cpu]);
  if (snap.power != null && snap.power > 0)
    rows.push([nodeSeriesKey(snap.siteId, 'pbs', 'watts'), snap.power]);
  if (!rows.length) return;
  const stmt = getDb().prepare('INSERT INTO timeseries(series_key, ts, value) VALUES(?, ?, ?)');
  getDb().transaction(() => {
    for (const [k, v] of rows) stmt.run(k, ts, v);
  })();
}

/** Read one series, bucket-averaged to ~`points` samples over [fromSec, toSec]. */
export function readSeries(
  key: string,
  fromSec: number,
  toSec: number,
  points: number,
): SeriesPoint[] {
  const span = Math.max(1, toSec - fromSec);
  const bucket = Math.max(1, Math.floor(span / points));
  const rows = getDb()
    .prepare(
      `SELECT (ts / ?) * ? AS b, AVG(value) AS v
         FROM timeseries
        WHERE series_key = ? AND ts >= ? AND ts <= ?
        GROUP BY b ORDER BY b`,
    )
    .all(bucket, bucket, key, fromSec, toSec) as Array<{ b: number; v: number }>;
  return rows.map((r) => ({ t: r.b, v: r.v }));
}

/** Record a single temperature sample (°C) for a node. */
export function recordTemp(siteId: string, node: string, celsius: number): void {
  getDb()
    .prepare('INSERT INTO timeseries(series_key, ts, value) VALUES(?, ?, ?)')
    .run(nodeSeriesKey(siteId, node, 'temp'), Math.floor(Date.now() / 1000), celsius);
}

/** Record a single CPU power sample (watts) for a node. */
export function recordWatts(siteId: string, node: string, watts: number): void {
  getDb()
    .prepare('INSERT INTO timeseries(series_key, ts, value) VALUES(?, ?, ?)')
    .run(nodeSeriesKey(siteId, node, 'watts'), Math.floor(Date.now() / 1000), watts);
}

/** Record a single whole-system power sample (watts, via IPMI) for a node. */
export function recordSystemWatts(siteId: string, node: string, watts: number): void {
  getDb()
    .prepare('INSERT INTO timeseries(series_key, ts, value) VALUES(?, ?, ?)')
    .run(nodeSeriesKey(siteId, node, 'syswatts'), Math.floor(Date.now() / 1000), watts);
}

/** Record a single GPU temperature sample (°C) for the GPU at `idx` on a node. */
export function recordGpuTemp(siteId: string, node: string, idx: number, celsius: number): void {
  getDb()
    .prepare('INSERT INTO timeseries(series_key, ts, value) VALUES(?, ?, ?)')
    .run(nodeSeriesKey(siteId, node, `gputemp${idx}`), Math.floor(Date.now() / 1000), celsius);
}

/** Record a single GPU power sample (watts) for the GPU at `idx` on a node. */
export function recordGpuWatts(siteId: string, node: string, idx: number, watts: number): void {
  getDb()
    .prepare('INSERT INTO timeseries(series_key, ts, value) VALUES(?, ?, ?)')
    .run(nodeSeriesKey(siteId, node, `gpuwatts${idx}`), Math.floor(Date.now() / 1000), watts);
}

export function pruneOld(): void {
  const cutoff = Math.floor((Date.now() - RETENTION_MS) / 1000);
  const db = getDb();
  db.prepare('DELETE FROM timeseries WHERE ts < ?').run(cutoff);
  // Reclaim the space freed by the delete — otherwise it stays parked in the WAL file.
  db.pragma('wal_checkpoint(TRUNCATE)');
}
