import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { demoSeries } from '../monitoring/demo.js';
import { getAlerts, getPbsSnapshots, getSnapshots } from '../monitoring/poller.js';
import { addClient } from '../monitoring/sse.js';
import { readSeries, type SeriesPoint } from '../monitoring/timeseries.js';

const RANGES: Record<string, number> = { hour: 3600, day: 86_400, week: 604_800 };

export async function registerMonitoring(app: FastifyInstance): Promise<void> {
  app.get('/api/overview', async () => ({
    demo: env.demo,
    sites: getSnapshots(),
    pbs: getPbsSnapshots(),
    alerts: getAlerts(),
  }));

  app.get('/api/metrics', async (req) => {
    const q = req.query as { keys?: string; range?: string; points?: string };
    const keys = (q.keys ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 24);
    const rangeSec = RANGES[q.range ?? 'hour'] ?? RANGES.hour!;
    const points = Math.min(600, Math.max(20, Number(q.points ?? 180)));
    const to = Math.floor(Date.now() / 1000);
    const from = to - rangeSec;
    const series: Record<string, SeriesPoint[]> = {};
    for (const key of keys) {
      series[key] = env.demo ? demoSeries(key, from, to, points) : readSeries(key, from, to, points);
    }
    return { from, to, series };
  });

  // Server-Sent Events: initial state + live snapshot pushes from the poller.
  app.get('/api/stream', (_req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    for (const snap of getSnapshots()) {
      res.write(`event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`);
    }
    for (const snap of getPbsSnapshots()) {
      res.write(`event: pbs\ndata: ${JSON.stringify(snap)}\n\n`);
    }
    res.write(`event: alerts\ndata: ${JSON.stringify(getAlerts())}\n\n`);
    addClient(res);
  });
}
