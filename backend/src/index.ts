import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { env } from './config/env.js';
import { initDb } from './db/index.js';
import { initSecretKey } from './crypto/secretbox.js';
import { registerAuth } from './auth/plugin.js';
import { purgeExpiredSessions } from './auth/sessions.js';
import { bootstrapAdminFromEnv, needsSetup, regenerateSetupToken } from './auth/setup.js';
import { registerSites } from './routes/sites.js';
import { registerConfig } from './routes/config.js';
import { registerMonitoring } from './routes/monitoring.js';
import { registerNotify } from './routes/notify.js';
import { registerAccount } from './routes/account.js';
import { registerTools } from './routes/tools.js';
import { registerConnectivity } from './routes/connectivity.js';
import { applyConnectivity } from './connectivity/manager.js';
import { startPoller } from './monitoring/poller.js';
import { startTempPoller } from './monitoring/temps.js';
import { initNotify } from './notify/index.js';

async function main(): Promise<void> {
  // Core services must come up before the HTTP layer.
  initSecretKey();
  initDb();
  purgeExpiredSessions();
  initNotify();

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: env.isProd ? undefined : { target: 'pino-pretty' },
    },
  });

  // Treat an empty application/json body as `undefined` instead of 400ing —
  // bodyless POSTs (e.g. logout) otherwise fail before reaching their handler.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      if (body === '' || body == null) return done(null, undefined);
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        (err as { statusCode?: number }).statusCode = 400;
        done(err as Error, undefined);
      }
    },
  );

  await registerAuth(app);
  await registerSites(app);
  await registerConfig(app);
  await registerMonitoring(app);
  await registerNotify(app);
  await registerAccount(app);
  await registerTools(app);
  await registerConnectivity(app);

  // logLevel:'silent' — the Docker HEALTHCHECK hits this every 30s; without this its
  // request logs would bury the first-run setup banner (and spam the logs generally).
  app.get('/api/health', { logLevel: 'silent' }, async () => ({
    status: 'ok',
    name: 'ProxView',
    version: env.version,
    demo: env.demo,
    time: new Date().toISOString(),
  }));

  // --- Static frontend (production only; Vite serves it in dev) ------------
  if (existsSync(join(env.frontendDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: env.frontendDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) {
        return reply.sendFile('index.html');
      }
      reply.code(404).send({ error: 'not_found' });
    });
  } else {
    app.log.warn(`No frontend build at ${env.frontendDir} — running API-only (dev mode).`);
  }

  await app.listen({ host: env.host, port: env.port });

  // Begin polling sites (or emitting demo snapshots) and pushing over SSE.
  startPoller({ error: (msg) => app.log.error(msg) });
  startTempPoller({ error: (msg) => app.log.error(msg) });

  // Bring up any tunnels the user has configured (Cloudflare / Tailscale).
  applyConnectivity({
    info: (msg) => app.log.info(msg),
    error: (msg) => app.log.error(msg),
  });

  // On a fresh install, either provision the admin from the environment (scripted
  // deploys) or print a one-time setup link to the logs.
  if (needsSetup()) {
    const admin = await bootstrapAdminFromEnv();
    if (admin) {
      printAdminBanner(admin);
    } else {
      const token = regenerateSetupToken();
      const show = (): void => {
        if (needsSetup()) printSetupBanner(token);
      };
      // Print just after boot so the link lands after Fastify's own "listening" logs —
      // i.e. it's the LAST thing on a fresh start. Then keep re-printing it at the tail
      // every 60s while setup is pending, so `docker logs` always ends with it.
      setTimeout(show, 250).unref();
      const reminder = setInterval(() => {
        if (needsSetup()) printSetupBanner(token);
        else clearInterval(reminder);
      }, 60_000);
      reminder.unref();
    }
  }
}

function printAdminBanner(username: string): void {
  const url = `http://localhost:${env.port}/login`;
  const line = '─'.repeat(46);
  console.log(
    `\n┌${line}┐\n` +
      `  ProxView admin '${username}' created from the environment.\n` +
      `  Log in with your PROXVIEW_ADMIN_PASSWORD at:\n\n` +
      `    ${url}\n\n` +
      `  (replace localhost with your server's host/IP if remote)\n` +
      `└${line}┘\n`,
  );
}

function printSetupBanner(token: string): void {
  const url = `http://localhost:${env.port}/setup?token=${token}`;
  const line = '─'.repeat(Math.max(url.length + 4, 46));
  // Deliberately console.log so it's visible regardless of log level/format.
  console.log(
    `\n┌${line}┐\n` +
      `  ProxView first-run setup — open this link to create your admin account:\n\n` +
      `    ${url}\n\n` +
      `  (replace localhost with your server's host/IP if remote)\n` +
      `└${line}┘\n`,
  );
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
