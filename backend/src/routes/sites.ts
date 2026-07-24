import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { testPbs } from '../monitoring/pbs.js';
import { testPve } from '../monitoring/pve.js';
import { onboardMachine, provisionSensors, unprovisionMachine } from '../monitoring/sshSetup.js';
import {
  createSite,
  deleteSite,
  getConnConfig,
  getSiteSshTarget,
  listSites,
  setSiteSsh,
  updateSite,
} from '../sites/repo.js';

const siteSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['pve', 'pbs']),
  baseUrl: z.string().trim().url(),
  tokenId: z.string().trim().min(3).max(200),
  tokenSecret: z.string().trim().min(1).max(400),
  tlsVerify: z.boolean().default(false),
  sshHost: z.string().trim().max(255).optional().nullable(),
  sshUser: z.string().trim().max(64).optional().nullable(),
  sshPort: z.number().int().positive().max(65535).optional().nullable(),
  sshKey: z.string().max(20000).optional().nullable(),
});

// Edit reuses the shape but secrets may be blank (= keep existing).
const updateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().url(),
  tokenId: z.string().trim().min(3).max(200),
  tokenSecret: z.string().max(400).optional().nullable(),
  tlsVerify: z.boolean().default(false),
  sshHost: z.string().trim().max(255).optional().nullable(),
  sshUser: z.string().trim().max(64).optional().nullable(),
  sshPort: z.number().int().positive().max(65535).optional().nullable(),
  sshKey: z.string().max(20000).optional().nullable(),
});

type SiteBody = z.infer<typeof siteSchema>;

function testConfig(d: SiteBody) {
  return {
    siteId: 'test',
    name: d.name,
    baseUrl: d.baseUrl,
    tokenId: d.tokenId,
    tokenSecret: d.tokenSecret,
    tlsVerify: d.tlsVerify,
  };
}

export async function registerSites(app: FastifyInstance): Promise<void> {
  app.get('/api/sites', async () => ({ sites: listSites() }));

  // Validate credentials without persisting — the "Test connection" button.
  app.post('/api/sites/test', async (req, reply) => {
    const parsed = siteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const d = parsed.data;
    return d.kind === 'pbs' ? testPbs(testConfig(d)) : testPve(testConfig(d));
  });

  app.post('/api/sites', async (req, reply) => {
    const parsed = siteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    const d = parsed.data;
    const test = d.kind === 'pbs' ? await testPbs(testConfig(d)) : await testPve(testConfig(d));
    // Persist regardless of test outcome so an offline/mis-typed site can be fixed later.
    const site = createSite(d);
    return { site, test };
  });

  // Edit a site. Secrets left blank are preserved (see updateSite).
  app.put('/api/sites/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    const site = updateSite(id, parsed.data);
    if (!site) return reply.code(404).send({ error: 'not_found' });
    const cfg = getConnConfig(id);
    const test = cfg
      ? cfg.kind === 'pbs'
        ? await testPbs(cfg)
        : await testPve(cfg)
      : { ok: false, message: 'not found' };
    return { site, test };
  });

  app.delete('/api/sites/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' });

    // ?cleanup=1 → SSH back in and remove the token + authorized_key we placed (best-effort).
    let cleanup;
    if ((req.query as { cleanup?: string }).cleanup === '1') {
      const target = getSiteSshTarget(id);
      if (target) cleanup = await unprovisionMachine(target).catch(() => undefined);
    }

    if (!deleteSite(id)) return reply.code(404).send({ error: 'not_found' });
    return { ok: true, cleanup };
  });

  // Guided temperature setup: generate a key, install it + lm-sensors over SSH.
  const provisionSchema = z.object({
    host: z.string().trim().min(1).max(255),
    port: z.number().int().positive().max(65535).optional(),
    user: z.string().trim().min(1).max(64),
    password: z.string().min(1).max(400),
  });

  // One-password onboarding: SSH in, mint a read-only token, set up temps, add the site.
  app.post('/api/onboard', async (req, reply) => {
    const parsed = provisionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const { host, user } = parsed.data;
    const port = parsed.data.port ?? 22;
    const result = await onboardMachine({ host, port, user, password: parsed.data.password });

    let site;
    if (result.ok && result.kind && result.tokenId && result.tokenSecret && result.baseUrl) {
      site = createSite({
        name: result.hostname || host,
        kind: result.kind,
        baseUrl: result.baseUrl,
        tokenId: result.tokenId,
        tokenSecret: result.tokenSecret,
        tlsVerify: false,
        sshHost: host,
        sshUser: user,
        sshPort: port,
        sshKey: result.privateKey ?? null,
      });
    }
    const { privateKey: _pk, tokenSecret: _ts, ...safe } = result;
    return { ...safe, site };
  });

  app.post('/api/sites/:id/provision-temps', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' });
    const parsed = provisionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const { host, user } = parsed.data;
    const port = parsed.data.port ?? 22;

    const previousPrivateKey = getSiteSshTarget(id)?.privateKey;
    const result = await provisionSensors({ host, port, user, password: parsed.data.password, previousPrivateKey });
    // Persist the generated key only if the key was installed successfully.
    if (result.privateKey && result.steps.find((s) => s.name === 'Install SSH key')?.ok) {
      setSiteSsh(id, host, user, port, result.privateKey);
    }
    const { privateKey: _omit, ...safe } = result; // never return the key
    return safe;
  });
}
