import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../config/env.js';

let db: Database.Database | undefined;

/** Ordered, append-only migrations. Index + 1 == PRAGMA user_version after applying. */
const MIGRATIONS: string[] = [
  // v1 — initial schema (auth + sites)
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  CREATE INDEX idx_sessions_exp  ON sessions(expires_at);

  -- Monitored Proxmox VE / PBS endpoints. Secrets stored AES-256-GCM encrypted.
  CREATE TABLE sites (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL,
    kind             TEXT NOT NULL CHECK (kind IN ('pve','pbs')),
    base_url         TEXT NOT NULL,
    token_id         TEXT NOT NULL,
    token_secret_enc TEXT NOT NULL,
    tls_verify       INTEGER NOT NULL DEFAULT 0,
    tls_fingerprint  TEXT,
    ssh_host         TEXT,
    ssh_user         TEXT,
    ssh_port         INTEGER,
    ssh_key_enc      TEXT,
    enabled          INTEGER NOT NULL DEFAULT 1,
    created_at       INTEGER NOT NULL
  );
  `,
  // v2 — time-series samples (node cpu/mem/temp history)
  `
  CREATE TABLE timeseries (
    series_key TEXT NOT NULL,
    ts         INTEGER NOT NULL,   -- epoch seconds
    value      REAL NOT NULL
  );
  CREATE INDEX idx_ts_key_ts ON timeseries(series_key, ts);
  `,
  // v3 — notification channels + web-push subscriptions
  `
  CREATE TABLE channels (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL,        -- email | telegram | slack | webpush
    name       TEXT NOT NULL,
    enabled    INTEGER NOT NULL DEFAULT 1,
    config_enc TEXT NOT NULL,        -- encrypted JSON
    created_at INTEGER NOT NULL
  );
  CREATE TABLE push_subscriptions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint   TEXT UNIQUE NOT NULL,
    sub_json   TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
  // v4 — per-channel minimum severity ('info' = receive everything, incl. resolved)
  `ALTER TABLE channels ADD COLUMN min_level TEXT NOT NULL DEFAULT 'info';`,
];

export function initDb(): Database.Database {
  mkdirSync(env.dataDir, { recursive: true });
  const instance = new Database(join(env.dataDir, 'proxview.db'));
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  migrate(instance);
  db = instance;
  return instance;
}

function migrate(d: Database.Database): void {
  const current = d.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    const tx = d.transaction(() => {
      d.exec(MIGRATIONS[v]!);
      d.pragma(`user_version = ${v + 1}`);
    });
    tx();
  }
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialised — call initDb() first');
  return db;
}

// --- settings key/value helpers ------------------------------------------
export function getSetting(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .run(key, value);
}

export function deleteSetting(key: string): void {
  getDb().prepare('DELETE FROM settings WHERE key = ?').run(key);
}
