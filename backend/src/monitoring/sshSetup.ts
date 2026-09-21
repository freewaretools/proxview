import ssh2 from 'ssh2';
import { parseSensors } from './sensors.js';
import type { NodeTemps } from './types.js';

const { Client, utils } = ssh2;

/** Base64 SSH public key derived from a private key, or '' if it can't be parsed. */
function derivePublicSsh(privateKey: string): string {
  try {
    const parsed = utils.parseKey(privateKey);
    const key = Array.isArray(parsed) ? parsed[0] : parsed;
    return key && !(key instanceof Error) ? key.getPublicSSH().toString('base64') : '';
  } catch {
    return '';
  }
}

export interface ProvisionInput {
  host: string;
  port: number;
  user: string;
  password: string;
  /**
   * Private key from a previous provisioning run on this same site, if any. When set,
   * the matching authorized_keys entry is removed before the new key is installed —
   * this is what makes "reprovision after a hardware change" idempotent instead of
   * piling up stale keys on the host each time setup is re-run.
   */
  previousPrivateKey?: string;
}

export interface ProvisionStep {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ProvisionResult {
  ok: boolean;
  steps: ProvisionStep[];
  privateKey?: string; // stripped before returning to the client
  temps?: NodeTemps;
}

export interface UnprovisionTarget {
  kind: 'pve' | 'pbs';
  host: string;
  port: number;
  user: string;
  privateKey: string;
}

/**
 * Reverse of onboarding: SSH back in with the stored key and remove the ProxView
 * API token and the authorized_keys entry we added. Best-effort.
 */
export function unprovisionMachine(target: UnprovisionTarget): Promise<ProvisionResult> {
  return new Promise((resolve) => {
    const pubB64 = derivePublicSsh(target.privateKey);

    const tokenCmd =
      target.kind === 'pbs'
        ? 'proxmox-backup-manager user delete-token root@pam proxview >/dev/null 2>&1 && echo TOKENREMOVED'
        : 'pveum user token remove root@pam proxview >/dev/null 2>&1 && echo TOKENREMOVED';
    const keyCmd = pubB64
      ? `sed -i '\\|${pubB64}|d' ~/.ssh/authorized_keys 2>/dev/null && echo KEYREMOVED`
      : 'echo NOKEY';
    const script = `${tokenCmd}\n${keyCmd}`;

    let settled = false;
    let out = '';
    const conn = new Client();
    const finish = (r: ProvisionResult) => {
      if (settled) return;
      settled = true;
      try {
        conn.end();
      } catch {
        /* ignore */
      }
      resolve(r);
    };

    conn
      .on('ready', () => {
        conn.exec(script, (err, stream) => {
          if (err) {
            finish({ ok: false, steps: [{ name: 'Clean up', ok: false, detail: err.message }] });
            return;
          }
          stream
            .on('close', () => {
              const tokRemoved = out.includes('TOKENREMOVED');
              const keyRemoved = out.includes('KEYREMOVED');
              finish({
                ok: true,
                steps: [
                  { name: 'Connect', ok: true, detail: `Connected as ${target.user}` },
                  {
                    name: 'Remove API token',
                    ok: tokRemoved,
                    detail: tokRemoved ? 'root@pam!proxview removed' : 'token not found',
                  },
                  {
                    name: 'Remove SSH key',
                    ok: keyRemoved,
                    detail: keyRemoved ? 'authorized_keys cleaned' : 'key entry not found',
                  },
                ],
              });
            })
            .on('data', (d: Buffer) => {
              out += d.toString();
            })
            .stderr.on('data', (d: Buffer) => {
              out += d.toString();
            });
        });
      })
      .on('error', (e) => finish({ ok: false, steps: [{ name: 'Connect', ok: false, detail: e.message }] }))
      .connect({
        host: target.host,
        port: target.port,
        username: target.user,
        privateKey: target.privateKey,
        readyTimeout: 12000,
      });
  });
}

/**
 * Pull the minted token out of the onboarding script's stdout. Tolerates stray text around
 * the JSON (warnings, banners) by taking the outermost {...} between the markers, and
 * reports the first stderr line when nothing usable came back so the wizard can say why.
 */
export function parseTokenOutput(
  stdout: string,
  stderr: string,
): { tokenId?: string; tokenSecret?: string; error?: string } {
  const s = stdout.indexOf('===TOKENSTART===');
  const e = stdout.indexOf('===TOKENEND===');
  if (s >= 0 && e > s) {
    const body = stdout.slice(s + '===TOKENSTART==='.length, e);
    const a = body.indexOf('{');
    const b = body.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        const parsed = JSON.parse(body.slice(a, b + 1)) as {
          value?: string;
          'full-tokenid'?: string;
          tokenid?: string;
        };
        if (parsed.value) {
          return { tokenSecret: parsed.value, tokenId: parsed['full-tokenid'] ?? parsed.tokenid };
        }
      } catch {
        /* fall through to the error path */
      }
    }
  }
  // Last resort for a non-JSON rendering (e.g. a text table): PBS token secrets are UUIDs.
  if (s >= 0 && e > s) {
    const uuid = stdout
      .slice(s, e)
      .match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
    if (uuid) return { tokenSecret: uuid };
  }
  const reason = stderr
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !/^perl: warning|^\s*LANG|^\s*LC_|locale/i.test(l));
  return { error: reason?.slice(0, 200) };
}

export interface OnboardResult {
  ok: boolean;
  steps: ProvisionStep[];
  kind?: 'pve' | 'pbs';
  hostname?: string;
  baseUrl?: string;
  tokenId?: string;
  tokenSecret?: string;
  privateKey?: string;
  temps?: NodeTemps;
}

/**
 * One-password onboarding: SSH in, detect PVE/PBS, mint a read-only monitoring API
 * token, install the temp SSH key + lm-sensors, and return everything needed to add
 * the site. The password is used once for this connection and never stored.
 */
export function onboardMachine(input: ProvisionInput): Promise<OnboardResult> {
  return new Promise((resolve) => {
    let keys: { private: string; public: string };
    try {
      keys = utils.generateKeyPairSync('ed25519') as { private: string; public: string };
    } catch (err) {
      resolve({ ok: false, steps: [{ name: 'Generate SSH key', ok: false, detail: (err as Error).message }] });
      return;
    }
    const pub = keys.public.trim();
    const script = [
      'KIND=',
      'command -v pveum >/dev/null 2>&1 && KIND=pve',
      'command -v proxmox-backup-manager >/dev/null 2>&1 && KIND=pbs',
      'echo "===KIND:$KIND==="',
      'echo "===HOST:$(hostname -s 2>/dev/null || hostname)==="',
      'mkdir -p ~/.ssh && chmod 700 ~/.ssh',
      `grep -qxF '${pub}' ~/.ssh/authorized_keys 2>/dev/null || echo '${pub}' >> ~/.ssh/authorized_keys`,
      'chmod 600 ~/.ssh/authorized_keys',
      'echo "===KEY==="',
      'if ! command -v sensors >/dev/null 2>&1; then export DEBIAN_FRONTEND=noninteractive; apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq lm-sensors >/dev/null 2>&1; fi',
      'command -v sensors >/dev/null 2>&1 && echo "===SENSORS==="',
      'if [ "$KIND" = pve ]; then',
      '  pveum user token remove root@pam proxview >/dev/null 2>&1',
      '  echo "===TOKENSTART==="',
      '  pveum user token add root@pam proxview --output-format json',
      '  echo "===TOKENEND==="',
      "  pveum acl modify / --roles PVEAuditor --tokens 'root@pam!proxview' >/dev/null 2>&1 && echo \"===ACL===\"",
      'fi',
      'if [ "$KIND" = pbs ]; then',
      '  proxmox-backup-manager user delete-token root@pam proxview >/dev/null 2>&1',
      '  echo "===TOKENSTART==="',
      // PBS's generate-token rejects --output-format; it prints `Result: {json}` by default.
      '  proxmox-backup-manager user generate-token root@pam proxview',
      '  echo "===TOKENEND==="',
      "  proxmox-backup-manager acl update / Audit --auth-id 'root@pam!proxview' >/dev/null 2>&1 && echo \"===ACL===\"",
      'fi',
      'echo "===TEMPS==="',
      'sensors -j 2>/dev/null || echo "{}"',
    ].join('\n');

    let settled = false;
    let out = '';
    let errOut = ''; // stderr kept apart so warnings can't corrupt the token JSON
    const conn = new Client();
    const finish = (r: OnboardResult) => {
      if (settled) return;
      settled = true;
      try {
        conn.end();
      } catch {
        /* ignore */
      }
      resolve(r);
    };

    conn
      .on('ready', () => {
        conn.exec(script, (err, stream) => {
          if (err) {
            finish({
              ok: false,
              steps: [
                { name: 'Connect', ok: true, detail: 'Connected via password' },
                { name: 'Run onboarding', ok: false, detail: err.message },
              ],
            });
            return;
          }
          stream
            .on('close', () => {
              const steps: ProvisionStep[] = [
                { name: 'Connect', ok: true, detail: `Connected as ${input.user}` },
              ];
              const kind = (out.match(/===KIND:(pve|pbs)===/)?.[1] as 'pve' | 'pbs' | undefined) ?? undefined;
              steps.push({
                name: 'Detect type',
                ok: !!kind,
                detail: kind ? (kind === 'pbs' ? 'Proxmox Backup Server' : 'Proxmox VE') : 'Not a Proxmox host',
              });
              const hostname = out.match(/===HOST:(.*)===/)?.[1]?.trim() || '';
              const keyOk = out.includes('===KEY===');
              steps.push({ name: 'Install SSH key', ok: keyOk, detail: keyOk ? 'authorized_keys updated' : 'failed' });
              const sensorsOk = out.includes('===SENSORS===');
              steps.push({
                name: 'Install lm-sensors',
                ok: sensorsOk,
                detail: sensorsOk ? 'lm-sensors available' : 'not installed',
              });

              const minted = parseTokenOutput(out, errOut);
              const tokenSecret = minted.tokenSecret;
              const tokenId = minted.tokenId ?? 'root@pam!proxview';
              steps.push({
                name: 'Create API token',
                ok: !!tokenSecret,
                detail: tokenSecret
                  ? tokenId
                  : `Failed to create token${minted.error ? ` — ${minted.error}` : ''}`,
              });
              const aclOk = out.includes('===ACL===');
              steps.push({
                name: 'Grant read-only role',
                ok: aclOk,
                detail: aclOk ? (kind === 'pbs' ? 'Audit on /' : 'PVEAuditor on /') : 'not applied',
              });

              const tempsPart = out.split('===TEMPS===')[1]?.trim() || '{}';
              let temps: NodeTemps = { readings: [] };
              try {
                temps = parseSensors(JSON.parse(tempsPart) as Record<string, unknown>);
              } catch {
                /* no sensors */
              }
              steps.push({
                name: 'Read temperatures',
                ok: temps.readings.length > 0,
                detail: temps.readings.length > 0 ? `${temps.readings.length} sensor(s)` : 'no sensors',
              });

              const ok = !!kind && !!tokenSecret && keyOk;
              finish({
                ok,
                steps,
                kind,
                hostname,
                baseUrl: kind ? `https://${input.host}:${kind === 'pbs' ? 8007 : 8006}` : undefined,
                tokenId: tokenSecret ? tokenId : undefined,
                tokenSecret,
                privateKey: keys.private,
                temps,
              });
            })
            .on('data', (d: Buffer) => {
              out += d.toString();
            })
            .stderr.on('data', (d: Buffer) => {
              errOut += d.toString();
            });
        });
      })
      .on('error', (e) => finish({ ok: false, steps: [{ name: 'Connect', ok: false, detail: e.message }] }))
      .connect({
        host: input.host,
        port: input.port,
        username: input.user,
        password: input.password,
        readyTimeout: 12000,
      });
  });
}

/**
 * Guided temperature setup: generate an SSH key, connect once with the supplied
 * password, install the public key + lm-sensors, and verify `sensors -j`. The
 * password is used only for this connection and never stored.
 */
export function provisionSensors(input: ProvisionInput): Promise<ProvisionResult> {
  return new Promise((resolve) => {
    let keys: { private: string; public: string };
    try {
      keys = utils.generateKeyPairSync('ed25519') as { private: string; public: string };
    } catch (err) {
      resolve({
        ok: false,
        steps: [{ name: 'Generate SSH key', ok: false, detail: (err as Error).message }],
      });
      return;
    }

    const pub = keys.public.trim();
    const oldPub = input.previousPrivateKey ? derivePublicSsh(input.previousPrivateKey) : '';
    const script = [
      'mkdir -p ~/.ssh && chmod 700 ~/.ssh',
      // Reprovisioning: drop the old ProxView-installed key first so re-running setup
      // (e.g. after a hardware change) doesn't pile up stale authorized_keys entries.
      ...(oldPub ? [`sed -i '\\|${oldPub}|d' ~/.ssh/authorized_keys 2>/dev/null && echo '===OLDKEYREMOVED==='`] : []),
      `grep -qxF '${pub}' ~/.ssh/authorized_keys 2>/dev/null || echo '${pub}' >> ~/.ssh/authorized_keys`,
      'chmod 600 ~/.ssh/authorized_keys',
      "echo '===KEY==='",
      'if ! command -v sensors >/dev/null 2>&1; then export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq lm-sensors; fi',
      "command -v sensors >/dev/null 2>&1 && echo '===SENSORS==='",
      'yes | sensors-detect --auto >/dev/null 2>&1 || true',
      "echo '===TEMPS==='",
      'sensors -j 2>/dev/null || echo "{}"',
    ].join('\n');

    let settled = false;
    let out = '';
    const conn = new Client();
    const finish = (result: ProvisionResult) => {
      if (settled) return;
      settled = true;
      try {
        conn.end();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    conn
      .on('ready', () => {
        conn.exec(script, (err, stream) => {
          if (err) {
            finish({
              ok: false,
              steps: [
                { name: 'Connect', ok: true, detail: 'Connected via password' },
                { name: 'Run setup', ok: false, detail: err.message },
              ],
            });
            return;
          }
          stream
            .on('close', () => {
              const steps: ProvisionStep[] = [
                { name: 'Connect', ok: true, detail: `Connected as ${input.user}` },
              ];
              if (oldPub) {
                const oldRemoved = out.includes('===OLDKEYREMOVED===');
                steps.push({
                  name: 'Remove previous key',
                  ok: oldRemoved,
                  detail: oldRemoved ? 'Stale authorized_keys entry cleaned up' : 'Not found (already removed?)',
                });
              }
              const keyOk = out.includes('===KEY===');
              steps.push({
                name: 'Install SSH key',
                ok: keyOk,
                detail: keyOk ? 'Public key added to authorized_keys' : 'Failed to write key',
              });
              const sensorsOk = out.includes('===SENSORS===');
              steps.push({
                name: 'Install lm-sensors',
                ok: sensorsOk,
                detail: sensorsOk
                  ? 'lm-sensors available'
                  : 'Could not install (is the user root?)',
              });

              const jsonPart = out.split('===TEMPS===')[1]?.trim() || '{}';
              let temps: NodeTemps = { readings: [] };
              try {
                temps = parseSensors(JSON.parse(jsonPart) as Record<string, unknown>);
              } catch {
                /* no sensors */
              }
              const tempsOk = temps.readings.length > 0;
              steps.push({
                name: 'Read temperatures',
                ok: tempsOk,
                detail: tempsOk
                  ? `${temps.readings.length} sensor(s)${temps.cpu ? `, CPU ${Math.round(temps.cpu)}°C` : ''}`
                  : 'No sensors detected',
              });

              finish({ ok: keyOk && tempsOk, steps, privateKey: keys.private, temps });
            })
            .on('data', (d: Buffer) => {
              out += d.toString();
            })
            .stderr.on('data', (d: Buffer) => {
              out += d.toString();
            });
        });
      })
      .on('error', (e) => {
        finish({ ok: false, steps: [{ name: 'Connect', ok: false, detail: e.message }] });
      })
      .connect({
        host: input.host,
        port: input.port,
        username: input.user,
        password: input.password,
        readyTimeout: 12000,
      });
  });
}
