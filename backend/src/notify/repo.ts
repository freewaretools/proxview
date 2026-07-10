import { decryptSecret, encryptSecret } from '../crypto/secretbox.js';
import { deleteSetting, getDb, getSetting, setSetting } from '../db/index.js';
import type { ChannelType, NotifyLevel } from './types.js';

function level(v: unknown): NotifyLevel {
  return v === 'warn' || v === 'crit' ? v : 'info';
}

interface ChannelRow {
  id: number;
  type: ChannelType;
  name: string;
  enabled: number;
  config_enc: string;
  min_level: string;
  created_at: number;
}

export interface ChannelPublic {
  id: number;
  type: ChannelType;
  name: string;
  enabled: boolean;
  minLevel: NotifyLevel;
  summary: string;
}

export interface DecryptedChannel {
  id: number;
  type: ChannelType;
  name: string;
  enabled: boolean;
  minLevel: NotifyLevel;
  config: Record<string, unknown>;
}

function summarize(type: ChannelType, config: Record<string, unknown>): string {
  switch (type) {
    case 'email':
      return `to ${String(config.to ?? '')}`;
    case 'telegram':
      return `chat ${String(config.chatId ?? '')}`;
    case 'slack':
      return 'incoming webhook';
    case 'webpush':
      return `${pushSubscriptionCount()} device(s)`;
  }
}

function decode(row: ChannelRow): DecryptedChannel {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    enabled: row.enabled === 1,
    minLevel: level(row.min_level),
    config: JSON.parse(decryptSecret(row.config_enc)) as Record<string, unknown>,
  };
}

export function listChannels(): ChannelPublic[] {
  const rows = getDb().prepare('SELECT * FROM channels ORDER BY id').all() as ChannelRow[];
  return rows.map((r) => {
    const config = JSON.parse(decryptSecret(r.config_enc)) as Record<string, unknown>;
    return {
      id: r.id,
      type: r.type,
      name: r.name,
      enabled: r.enabled === 1,
      minLevel: level(r.min_level),
      summary: summarize(r.type, config),
    };
  });
}

export function listEnabledChannels(): DecryptedChannel[] {
  const rows = getDb()
    .prepare('SELECT * FROM channels WHERE enabled = 1')
    .all() as ChannelRow[];
  return rows.map(decode);
}

export function getChannel(id: number): DecryptedChannel | undefined {
  const row = getDb().prepare('SELECT * FROM channels WHERE id = ?').get(id) as
    | ChannelRow
    | undefined;
  return row ? decode(row) : undefined;
}

export function createChannel(
  type: ChannelType,
  name: string,
  config: Record<string, unknown>,
  minLevel: NotifyLevel = 'info',
): ChannelPublic {
  const info = getDb()
    .prepare(
      'INSERT INTO channels(type, name, enabled, config_enc, min_level, created_at) VALUES(?, ?, 1, ?, ?, ?)',
    )
    .run(type, name, encryptSecret(JSON.stringify(config)), level(minLevel), Date.now());
  return {
    id: Number(info.lastInsertRowid),
    type,
    name,
    enabled: true,
    minLevel: level(minLevel),
    summary: summarize(type, config),
  };
}

export function updateChannel(
  id: number,
  patch: { name?: string; enabled?: boolean; minLevel?: NotifyLevel; config?: Record<string, unknown> },
): ChannelPublic | undefined {
  const existing = getChannel(id);
  if (!existing) return undefined;
  const name = patch.name ?? existing.name;
  const enabled = patch.enabled ?? existing.enabled;
  const minLevel = level(patch.minLevel ?? existing.minLevel);
  const config = patch.config ?? existing.config;
  getDb()
    .prepare('UPDATE channels SET name = ?, enabled = ?, min_level = ?, config_enc = ? WHERE id = ?')
    .run(name, enabled ? 1 : 0, minLevel, encryptSecret(JSON.stringify(config)), id);
  return { id, type: existing.type, name, enabled, minLevel, summary: summarize(existing.type, config) };
}

export function deleteChannel(id: number): boolean {
  return getDb().prepare('DELETE FROM channels WHERE id = ?').run(id).changes > 0;
}

// --- web-push subscriptions ---------------------------------------------
export function savePushSubscription(sub: { endpoint: string } & Record<string, unknown>): void {
  getDb()
    .prepare(
      `INSERT INTO push_subscriptions(endpoint, sub_json, created_at) VALUES(?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET sub_json = excluded.sub_json`,
    )
    .run(sub.endpoint, JSON.stringify(sub), Date.now());
}

export function listPushSubscriptions(): Array<{ endpoint: string; sub: unknown }> {
  const rows = getDb().prepare('SELECT endpoint, sub_json FROM push_subscriptions').all() as Array<{
    endpoint: string;
    sub_json: string;
  }>;
  return rows.map((r) => ({ endpoint: r.endpoint, sub: JSON.parse(r.sub_json) }));
}

export function deletePushSubscription(endpoint: string): void {
  getDb().prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

export function pushSubscriptionCount(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get() as { n: number }).n;
}

// --- VAPID keypair (settings) -------------------------------------------
export function getVapid(): { publicKey: string; privateKey: string } | undefined {
  const raw = getSetting('vapid');
  return raw ? (JSON.parse(raw) as { publicKey: string; privateKey: string }) : undefined;
}

export function setVapid(keys: { publicKey: string; privateKey: string }): void {
  setSetting('vapid', JSON.stringify(keys));
}

export function clearVapid(): void {
  deleteSetting('vapid');
}
