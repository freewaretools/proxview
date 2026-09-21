import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BlockList, isIP } from 'node:net';
import { networkInterfaces } from 'node:os';

/**
 * Parse + validate a pasted wg-quick style config (what the WireGuard GUI / `wg-quick`
 * produces). Anything that could run commands or hijack the container's networking is
 * rejected; the rest is re-emitted from an allowlist so only known keys reach `wg-quick`.
 */

export interface WireguardSummary {
  /** ProxView's address(es) on the tunnel. */
  address: string;
  /** ProxView's public key — what the remote WireGuard server needs as a peer. */
  publicKey: string;
  peers: Array<{ endpoint?: string; allowedIps: string }>;
}

export interface ParsedWireguard {
  /** Clean config text, safe to hand to `wg-quick up`. */
  sanitized: string;
  summary: WireguardSummary;
}

export class WireguardConfigError extends Error {}

const KEY_RE = /^[A-Za-z0-9+/]{43}=$/;
const INTERFACE_KEYS = ['PrivateKey', 'Address', 'ListenPort', 'MTU'] as const;
const PEER_KEYS = ['PublicKey', 'PresharedKey', 'Endpoint', 'AllowedIPs', 'PersistentKeepalive'] as const;
// These run shell commands (or rewrite the config) — never accept them from a pasted blob.
const FORBIDDEN = ['preup', 'postup', 'predown', 'postdown', 'saveconfig'];
// Harmless in a container, but wg-quick can't act on them (no resolvconf, no routing table
// control) — dropped silently. Anything else outside the allowlist below is dropped too.
const DROPPED = ['dns', 'table', 'fwmark'];

type Section = Record<string, string>;

function fail(msg: string): never {
  throw new WireguardConfigError(msg);
}

/** Raw X25519 private key (base64) → its public key (base64). */
export function derivePublicKey(privateKeyB64: string): string {
  const raw = Buffer.from(privateKeyB64, 'base64');
  // PKCS#8 wrapper for a raw 32-byte X25519 key.
  const der = Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), raw]);
  const pub = createPublicKey(createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }));
  const spki = pub.export({ type: 'spki', format: 'der' });
  return spki.subarray(spki.length - 32).toString('base64');
}

export function parseWireguardConfig(text: string): ParsedWireguard {
  const interfaces: Section[] = [];
  const peers: Section[] = [];
  let current: Section | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;

    const header = /^\[(\w+)\]$/.exec(line);
    if (header) {
      const name = header[1]!.toLowerCase();
      current = {};
      if (name === 'interface') interfaces.push(current);
      else if (name === 'peer') peers.push(current);
      else fail(`Unknown section [${header[1]}].`);
      continue;
    }

    const eq = line.indexOf('=');
    if (eq < 1 || !current) fail(`Couldn't read this line: "${line.slice(0, 60)}"`);
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    const lower = key.toLowerCase();

    if (FORBIDDEN.includes(lower)) {
      fail(`"${key}" runs commands on the container and isn't allowed — remove that line.`);
    }
    if (DROPPED.includes(lower)) continue;
    current[lower] = value;
  }

  if (interfaces.length !== 1) fail('Expected exactly one [Interface] section.');
  if (!peers.length) fail('Expected at least one [Peer] section.');
  const iface = interfaces[0]!;

  const privateKey = iface.privatekey;
  if (!privateKey) fail('[Interface] is missing PrivateKey.');
  if (!KEY_RE.test(privateKey)) fail('[Interface] PrivateKey is not a valid WireGuard key.');
  if (!iface.address) fail('[Interface] is missing Address.');
  if (!/^[0-9a-fA-F:.,/\s]+$/.test(iface.address)) fail('[Interface] Address looks invalid.');
  if (iface.listenport && !/^\d{1,5}$/.test(iface.listenport)) fail('[Interface] ListenPort looks invalid.');
  if (iface.mtu && !/^\d{3,5}$/.test(iface.mtu)) fail('[Interface] MTU looks invalid.');

  const out: string[] = ['[Interface]'];
  for (const k of INTERFACE_KEYS) {
    const v = iface[k.toLowerCase()];
    if (v) out.push(`${k} = ${v}`);
  }

  const peerSummary: WireguardSummary['peers'] = [];
  peers.forEach((p, i) => {
    const n = i + 1;
    if (!p.publickey || !KEY_RE.test(p.publickey)) fail(`[Peer] #${n} has a missing or invalid PublicKey.`);
    if (p.presharedkey && !KEY_RE.test(p.presharedkey)) fail(`[Peer] #${n} PresharedKey is invalid.`);
    if (!p.allowedips) fail(`[Peer] #${n} is missing AllowedIPs.`);
    if (!/^[0-9a-fA-F:.,/\s]+$/.test(p.allowedips)) fail(`[Peer] #${n} AllowedIPs looks invalid.`);
    // A full tunnel would send ProxView's own UI replies (and everything else) down the
    // tunnel too. Only route the subnets the nodes live on.
    if (p.allowedips.split(',').some((c) => /\/0$/.test(c.trim()))) {
      fail(
        `[Peer] #${n} AllowedIPs contains a default route (0.0.0.0/0 or ::/0). ` +
          `Set it to just the subnets your Proxmox nodes are on, e.g. 192.168.1.0/24.`,
      );
    }
    if (p.endpoint && !/^[\w.\-[\]:]+:\d{1,5}$/.test(p.endpoint)) fail(`[Peer] #${n} Endpoint should be host:port.`);
    if (p.persistentkeepalive && !/^\d{1,5}$/.test(p.persistentkeepalive)) {
      fail(`[Peer] #${n} PersistentKeepalive should be a number of seconds.`);
    }

    out.push('', '[Peer]');
    for (const k of PEER_KEYS) {
      const v = p[k.toLowerCase()];
      if (v) out.push(`${k} = ${v}`);
    }
    peerSummary.push({ endpoint: p.endpoint, allowedIps: p.allowedips.replace(/\s+/g, '') });
  });

  return {
    sanitized: out.join('\n') + '\n',
    summary: {
      address: iface.address.replace(/\s+/g, ''),
      publicKey: derivePublicKey(privateKey),
      peers: peerSummary,
    },
  };
}

// --- Lockout guard ---------------------------------------------------------
//
// Every AllowedIPs range becomes a route inside the container. A range that covers the
// address you're browsing from sends replies into the tunnel instead of back to you, and
// the container becomes unreachable (and re-applies the same config on every restart).
// These checks refuse such a config at save time, with a message that says what to change.

/** Normalise an address: drop an IPv6 zone and unwrap IPv4-mapped IPv6 (::ffff:1.2.3.4). */
function normalizeIp(ip: string): { ip: string; family: 'ipv4' | 'ipv6' } | undefined {
  let a = ip.trim().replace(/%.+$/, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a);
  if (mapped) a = mapped[1]!;
  const v = isIP(a);
  return v ? { ip: a, family: v === 4 ? 'ipv4' : 'ipv6' } : undefined;
}

function cidrContains(cidr: string, address: string): boolean {
  const [net, prefixStr] = cidr.split('/');
  const base = normalizeIp(net ?? '');
  const target = normalizeIp(address);
  if (!base || !target || base.family !== target.family) return false;
  const prefix = Number(prefixStr);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > (base.family === 'ipv4' ? 32 : 128)) return false;
  const list = new BlockList();
  list.addSubnet(base.ip, prefix, base.family);
  return list.check(target.ip, target.family);
}

/** ProxView's own addresses + IPv4 default gateway (Linux), which must never be tunnelled. */
export function localNetworkAddresses(): string[] {
  const out: string[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (name.startsWith('pvwg')) continue;
    for (const a of addrs ?? []) if (!a.internal) out.push(a.address);
  }
  try {
    for (const line of readFileSync('/proc/net/route', 'utf8').split('\n').slice(1)) {
      const [, dest, gw] = line.trim().split(/\s+/);
      if (dest === '00000000' && gw && gw !== '00000000') {
        // Little-endian hex → dotted quad.
        out.push([6, 4, 2, 0].map((i) => parseInt(gw.slice(i, i + 2), 16)).join('.'));
      }
    }
  } catch {
    /* not Linux / no /proc — the other checks still apply */
  }
  return out;
}

export interface LockoutContext {
  /** Remote address of the request being served — where its replies have to go. */
  clientIp?: string;
  /** ProxView's own interface addresses and default gateway. */
  localAddresses?: string[];
}

/** Returns a human-readable reason this config would cut ProxView off, or undefined if safe. */
export function findLockoutRisk(
  peers: WireguardSummary['peers'],
  ctx: LockoutContext,
): string | undefined {
  for (const [i, peer] of peers.entries()) {
    const label = peers.length > 1 ? `Peer ${i + 1}` : 'The peer';
    const cidrs = peer.allowedIps.split(',').filter(Boolean);

    if (ctx.clientIp) {
      const hit = cidrs.find((c) => cidrContains(c, ctx.clientIp!));
      if (hit) {
        return (
          `${label}'s AllowedIPs range ${hit} includes ${normalizeIp(ctx.clientIp)?.ip ?? ctx.clientIp}, ` +
          `the address you're using to reach ProxView. Connecting would send its replies into the ` +
          `tunnel and lock you out. List only the subnets of your remote nodes (not your local ` +
          `network, and not a broad range like 192.168.0.0/16 that covers it).`
        );
      }
    }

    const host = peer.endpoint
      ? (/^\[([^\]]+)\]:\d+$/.exec(peer.endpoint)?.[1] ?? /^([^:]+):\d+$/.exec(peer.endpoint)?.[1])
      : undefined;
    if (host && isIP(host)) {
      const hit = cidrs.find((c) => cidrContains(c, host));
      if (hit) {
        return (
          `${label}'s Endpoint ${host} is inside its own AllowedIPs range ${hit}, so the tunnel's ` +
          `packets would be routed back into the tunnel and it could never connect. Narrow AllowedIPs ` +
          `so it excludes the WireGuard server's address.`
        );
      }
    }

    for (const addr of ctx.localAddresses ?? []) {
      const hit = cidrs.find((c) => cidrContains(c, addr));
      if (hit) {
        return (
          `${label}'s AllowedIPs range ${hit} covers ${addr}, part of ProxView's own network ` +
          `(its address or gateway). That would break its connectivity. Narrow AllowedIPs to your ` +
          `remote subnets.`
        );
      }
    }
  }
  return undefined;
}
