import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getConnectivity, setConnectivity } from '../connectivity/store.js';
import { applyConnectivity, connectivityStatus } from '../connectivity/manager.js';
import {
  findLockoutRisk,
  localNetworkAddresses,
  parseWireguardConfig,
  WireguardConfigError,
} from '../connectivity/wireguard.js';

const cloudflareBody = z.object({
  enabled: z.boolean(),
  // Optional so a user can toggle off/on without re-pasting the token.
  token: z.string().trim().optional(),
});

const tailscaleBody = z.object({
  enabled: z.boolean(),
  authKey: z.string().trim().optional(),
  funnel: z.boolean().optional(),
});

const wireguardBody = z.object({
  enabled: z.boolean(),
  // Optional so a user can toggle off/on without re-pasting (the saved config is never sent back).
  config: z.string().max(20_000).optional(),
});

export async function registerConnectivity(app: FastifyInstance): Promise<void> {
  app.get('/api/connectivity', async () => connectivityStatus());

  app.post('/api/connectivity/cloudflare', async (req, reply) => {
    const parsed = cloudflareBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const { enabled, token } = parsed.data;
    const cfg = getConnectivity();
    cfg.cloudflare.enabled = enabled;
    if (token) cfg.cloudflare.token = token;
    if (enabled && !cfg.cloudflare.token) {
      return reply.code(400).send({ error: 'token_required' });
    }
    setConnectivity(cfg);
    applyConnectivity();
    return connectivityStatus();
  });

  app.post('/api/connectivity/tailscale', async (req, reply) => {
    const parsed = tailscaleBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const { enabled, authKey, funnel } = parsed.data;
    const cfg = getConnectivity();
    cfg.tailscale.enabled = enabled;
    if (authKey) cfg.tailscale.authKey = authKey;
    if (typeof funnel === 'boolean') cfg.tailscale.funnel = funnel;
    if (enabled && !cfg.tailscale.authKey) {
      return reply.code(400).send({ error: 'authkey_required' });
    }
    setConnectivity(cfg);
    applyConnectivity();
    return connectivityStatus();
  });

  app.post('/api/connectivity/wireguard', async (req, reply) => {
    const parsed = wireguardBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const { enabled, config } = parsed.data;
    const cfg = getConnectivity();
    cfg.wireguard.enabled = enabled;
    if (config?.trim()) {
      try {
        // Store the sanitised form — forbidden/unknown keys never reach disk or wg-quick.
        cfg.wireguard.config = parseWireguardConfig(config).sanitized;
      } catch (err) {
        if (err instanceof WireguardConfigError) {
          return reply.code(400).send({ error: 'invalid_config', message: err.message });
        }
        throw err;
      }
    }
    if (enabled && !cfg.wireguard.config) {
      return reply.code(400).send({ error: 'config_required' });
    }
    if (enabled) {
      // Guard against a config that would route this very request's reply (or the tunnel's own
      // packets) into the tunnel. Checked on the config about to be applied — pasted or stored.
      let risk: string | undefined;
      try {
        risk = findLockoutRisk(parseWireguardConfig(cfg.wireguard.config).summary.peers, {
          clientIp: req.socket.remoteAddress,
          localAddresses: localNetworkAddresses(),
        });
      } catch {
        /* unparsable stored config: leave it to the manager to report */
      }
      if (risk) return reply.code(400).send({ error: 'unsafe_config', message: risk });
    }
    setConnectivity(cfg);
    applyConnectivity();
    return connectivityStatus();
  });
}
