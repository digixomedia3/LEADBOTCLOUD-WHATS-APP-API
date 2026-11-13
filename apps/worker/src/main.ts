import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import { createDb } from '@lbc/db';
import { GraphClient, verifyChallenge } from '@lbc/meta';
import { loadConfig } from './config';
import { ingestWebhook, markProcessed } from './receiver';
import { handleAccountUpdate, handleInbound, handleStatus, handleTemplateStatus, routeTenant } from './handlers';
import { sendOne } from './send';

/**
 * Process entry. Two jobs: (1) the HTTP receiver for Meta webhooks, (2) the queue consumers. They share one image but can be
 * split later. Nothing here holds business logic; that lives in receiver.ts, handlers.ts and send.ts, which are unit-tested.
 */
const cfg = loadConfig();
const { db, client } = createDb(cfg.DATABASE_URL_WORKER, { max: 10 });
const redis = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null });
const graph = new GraphClient({ graphVersion: cfg.META_GRAPH_VERSION, baseUrl: cfg.META_GRAPH_BASE_URL, appId: cfg.META_APP_ID, appSecret: cfg.META_APP_SECRET });

export const sendQueue = new Queue('send', { connection: redis, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 } });
const eventQueue = new Queue('events', { connection: redis, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000, attempts: 6, backoff: { type: 'exponential', delay: 5000 } } });

/** Send consumer. jobId = message id, so a message can be queued only once. */
const sendWorker = new Worker('send', async (job: Job<{ tenantId: string; messageId: string }>) => {
  const r = await sendOne({ db, graph, tokenKey: cfg.TOKEN_ENCRYPTION_KEY }, job.data.tenantId, job.data.messageId);
  if (r.kind === 'retry') { await sendQueue.add('send', job.data, { jobId: `${job.data.messageId}:r${job.attemptsMade + 1}`, delay: r.delayMs }); }
  return r.kind;
}, { connection: redis, concurrency: 20, limiter: { max: 80, duration: 1000 } }); // 80 messages/second is the default Cloud API per-number rate

/** Event consumer: one webhook_events row per job. Unknown routing is stored and left unprocessed for review, never guessed. */
const eventWorker = new Worker('events', async (job: Job<{ id: number }>) => {
  const row = (await db.execute(sql`select * from webhook_events where id = ${job.data.id}`) as unknown as Record<string, any>[])[0];
  if (!row || row.processed_at) return 'done';
  const payload = row.payload as Record<string, any>;
  const route = await routeTenant(db, row.waba_id, row.phone_number_id);
  if (route === 'unknown' || route === 'mismatch') { await markProcessed(db, row.id, route === 'unknown' ? 'unrouted: unknown WABA' : 'quarantined: phone number does not belong to this tenant'); return route; }
  let out: string = 'ignored';
  if (payload.kind === 'status') out = await handleStatus(db, route.tenantId, payload as never, job.attemptsMade);
  else if (payload.kind === 'message') {
    const r = await handleInbound(db, route.tenantId, row.phone_number_id, payload as never);
    out = r.outcome;
  } else if (payload.kind === 'template_status') out = await handleTemplateStatus(db, route.tenantId, payload as never);
  else if (payload.kind === 'account_update') out = await handleAccountUpdate(db, route.tenantId, payload as never);
  if (out === 'orphan_retry') throw new Error('message not found yet; will retry'); // BullMQ backs off
  await markProcessed(db, row.id);
  return out;
}, { connection: redis, concurrency: 10 });
for (const w of [sendWorker, eventWorker]) w.on('failed', (j, e) => console.error(`[${w.name}] job ${j?.id} failed: ${e.message}`));

/** Outbox sweeper: anything queued in the database but missing from Redis (a crash between the two) is re-enqueued. */
async function sweepOutbox() {
  const stuck = (await db.execute(sql`select id, tenant_id from messages where direction = 'out' and status = 'queued' and wamid is null and created_at < now() - interval '30 seconds' limit 500`)) as unknown as { id: string; tenant_id: string }[];
  for (const m of stuck) await sendQueue.add('send', { tenantId: m.tenant_id, messageId: m.id }, { jobId: m.id }).catch(() => undefined);
  return stuck.length;
}
const sweeper = setInterval(() => sweepOutbox().catch((e) => console.error('sweep', e.message)), 30_000);

const app = Fastify({ logger: { level: 'info', redact: ['req.headers.authorization', 'req.headers["x-hub-signature-256"]'] } });
app.removeAllContentTypeParsers();
app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body)); // raw bytes, so the HMAC is computed on exactly what Meta signed
app.get('/healthz', async () => ({ ok: true }));
app.get('/webhooks/meta', async (req, reply) => {
  const q = req.query as Record<string, string>;
  const v = verifyChallenge(q, cfg.META_WEBHOOK_VERIFY_TOKEN ?? '');
  return v.ok ? reply.type('text/plain').send(v.challenge) : reply.code(403).send('forbidden');
});
app.post('/webhooks/meta', async (req, reply) => {
  if (!cfg.META_APP_SECRET) return reply.code(503).send('not configured');
  const r = await ingestWebhook(db, req.body as Buffer, req.headers['x-hub-signature-256'] as string | undefined, cfg.META_APP_SECRET);
  if (r.status === 401) return reply.code(401).send('bad signature');
  await Promise.all(r.items.map((i) => eventQueue.add('event', { id: i.id }, { jobId: `ev-${i.id}` }))); // fast: store, enqueue, 200
  return reply.code(200).send('ok');
});

await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
const stop = async () => { clearInterval(sweeper); await app.close(); await Promise.all([sendWorker.close(), eventWorker.close()]); await redis.quit(); await client.end(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
