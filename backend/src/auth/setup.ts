import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { deleteSetting, getDb, getSetting, setSetting } from '../db/index.js';
import { hashPassword } from './passwords.js';

const TOKEN_KEY = 'setup_token_hash';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function userCount(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

export function needsSetup(): boolean {
  return userCount() === 0;
}

/**
 * Mint a fresh one-time setup token and persist only its hash. Called on every boot
 * while unconfigured, so a restart always yields a working (and printable) token and
 * invalidates any previous one.
 */
export function regenerateSetupToken(): string {
  const token = randomBytes(9).toString('hex'); // 18 hex chars
  setSetting(TOKEN_KEY, sha256(token));
  return token;
}

export function verifySetupToken(token: string): boolean {
  const stored = getSetting(TOKEN_KEY);
  if (!stored) return false;
  const a = Buffer.from(sha256(token));
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function clearSetupToken(): void {
  deleteSetting(TOKEN_KEY);
}

/**
 * Non-interactive first-run: if `PROXVIEW_ADMIN_PASSWORD` is set while unconfigured,
 * create the admin from the environment instead of the log-printed setup token — so a
 * scripted deploy (docker run / compose / the Proxmox LXC script) comes up ready to log
 * in. Returns the created username, or null if not bootstrapped (missing/invalid input).
 */
export async function bootstrapAdminFromEnv(): Promise<string | null> {
  if (!needsSetup()) return null;
  const password = process.env.PROXVIEW_ADMIN_PASSWORD;
  const username = (process.env.PROXVIEW_ADMIN_USER ?? 'admin').trim();
  if (!password) return null;
  if (password.length < 8) {
    console.warn(
      'PROXVIEW_ADMIN_PASSWORD is set but shorter than 8 characters — ignoring it and ' +
        'falling back to the one-time setup token.',
    );
    return null;
  }
  if (!username || username.length > 64) return null;
  const hash = await hashPassword(password);
  getDb()
    .prepare('INSERT INTO users(username, password_hash, created_at) VALUES(?, ?, ?)')
    .run(username, hash, Date.now());
  clearSetupToken();
  return username;
}
