import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getAlertConfig, setAlertConfig } from '../monitoring/alertConfig.js';
import { dispatch, testChannel } from '../notify/index.js';
import {
  createChannel,
  deleteChannel,
  getChannel,
  getVapid,
  listChannels,
  savePushSubscription,
  updateChannel,
} from '../notify/repo.js';
import type { ChannelType } from '../notify/types.js';

const configSchemas = {
  email: z.object({
    host: z.string().min(1),
    port: z.number().int().positive().max(65535),
    secure: z.boolean(),
    user: z.string().optional().default(''),
    pass: z.string().optional().default(''),
    from: z.string().min(1),
    to: z.string().min(1),
  }),
  telegram: z.object({ botToken: z.string().min(10), chatId: z.string().min(1) }),
  slack: z.object({ webhookUrl: z.string().url() }),
  webpush: z.object({}).passthrough(),
} as const;

function parseConfig(type: ChannelType, config: unknown) {
  return configSchemas[type].safeParse(config ?? {});
}

const levelSchema = z.enum(['info', 'warn', 'crit']);

const createSchema = z.object({
  type: z.enum(['email', 'telegram', 'slack', 'webpush']),
  name: z.string().trim().min(1).max(80),
  minLevel: levelSchema.optional(),
  config: z.unknown().optional(),
});

export async function registerNotify(app: FastifyInstance): Promise<void> {
  app.get('/api/channels', async () => ({ channels: listChannels() }));

  app.post('/api/channels/test', async (req, reply) => {
    const body = req.body as { type?: ChannelType; config?: unknown };
    if (!body?.type) return reply.code(400).send({ error: 'invalid_input' });
    const parsed = parseConfig(body.type, body.config);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_config' });
    return testChannel(body.type, parsed.data as Record<string, unknown>);
  });

  app.post('/api/channels', async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const cfg = parseConfig(parsed.data.type, parsed.data.config);
    if (!cfg.success) return reply.code(400).send({ error: 'invalid_config', details: cfg.error.flatten() });
    const channel = createChannel(
      parsed.data.type,
      parsed.data.name,
      cfg.data as Record<string, unknown>,
      parsed.data.minLevel,
    );
    const test = await testChannel(parsed.data.type, cfg.data as Record<string, unknown>);
    return { channel, test };
  });

  app.put('/api/channels/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' });
    const existing = getChannel(id);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const body = req.body as {
      name?: string;
      enabled?: boolean;
      minLevel?: unknown;
      config?: unknown;
    };
    let config: Record<string, unknown> | undefined;
    if (body.config !== undefined) {
      const cfg = parseConfig(existing.type, body.config);
      if (!cfg.success) return reply.code(400).send({ error: 'invalid_config' });
      config = cfg.data as Record<string, unknown>;
    }
    const minLevel = levelSchema.safeParse(body.minLevel);
    const channel = updateChannel(id, {
      name: body.name,
      enabled: body.enabled,
      minLevel: minLevel.success ? minLevel.data : undefined,
      config,
    });
    return { channel };
  });

  app.delete('/api/channels/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' });
    if (!deleteChannel(id)) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  app.post('/api/channels/:id/test', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const ch = getChannel(id);
    if (!ch) return reply.code(404).send({ error: 'not_found' });
    return testChannel(ch.type, ch.config);
  });

  // Fire a test alert through ALL enabled channels.
  app.post('/api/channels/test-all', async () => {
    await dispatch({
      title: 'ProxView test alert',
      body: 'This is a test of all enabled notification channels.',
      level: 'warn',
    });
    return { ok: true };
  });

  // --- alert rules (thresholds, severity, delivery, polling) ---
  app.get('/api/alerts', async () => getAlertConfig());

  app.put('/api/alerts', async (req, reply) => {
    if (typeof req.body !== 'object' || req.body === null) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    // setAlertConfig normalizes/clamps every field, so partial or unknown input is safe.
    return setAlertConfig(req.body as Parameters<typeof setAlertConfig>[0]);
  });

  // --- web push ---
  app.get('/api/push/vapid', async () => ({ publicKey: getVapid()?.publicKey ?? null }));

  app.post('/api/push/subscribe', async (req, reply) => {
    const sub = req.body as { endpoint?: string };
    if (!sub?.endpoint) return reply.code(400).send({ error: 'invalid_subscription' });
    savePushSubscription(sub as { endpoint: string } & Record<string, unknown>);
    return { ok: true };
  });
}
