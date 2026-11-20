import { RedisFairShareStore } from './fair-share-redis';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import { createDb } from '@lbc/db';
import { GraphClient, verifyChallenge, verifySignature } from '@lbc/meta';
import { GoogleClient, MetaLeadsClient } from '@lbc/connectors';
import { loadConfig } from './config';
import { ingestWebhook } from './receiver';
import { ingestBilling, processBillingEvent } from './billing';
import { ImportSourceNotFound, importLeads, ingestLead, submitForm } from './leads';
import { makeLimiter } from '@lbc/shared';
import { verifyInternal } from '@lbc/shared/internal-sign';
import { processEvent } from './events';
import { ingestMetaLeadgen, ingestShopify, pendingConnectorEvents, processConnectorEvent, syncSheets } from './connectors';
import { sendOne } from './send';
import { closeDueWorkspaces } from './closure';
import { runRetention } from './retention';
import { tickInboundMedia } from './inbound-media';
import { tickJourneys } from './journeys';
import { deferredJobId, dueJobId, retryJobId } from './queue-ids';
import { deleteQueuedTemplates, submitPendingTemplates, syncTemplates, tenantsDueForSync } from './templates';
import { dueCampaigns, launchCampaign, queuedMessageIds, rollupCampaigns } from './campaigns';
import { dueReleases, releaseWinner } from './ab-release';

/**
 * Process entry. Two jobs: (1) the HTTP receiver for Meta webhooks, (2) the queue consumers. They share one image but can be
 * split later. Nothing here holds business logic; that lives in receiver.ts, handlers.ts and send.ts, which are unit-tested.
 */
const cfg = loadConfig();
const { db, client } = createDb(cfg.DATABASE_URL_WORKER, { max: 10 });
const redis = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null });
const graph = new GraphClient({ graphVersion: cfg.META_GRAPH_VERSION, baseUrl: cfg.META_GRAPH_BASE_URL, appId: cfg.META_APP_ID, appSecret: cfg.META_APP_SECRET });

const metaLeads = cfg.META_APP_ID && cfg.META_APP_SECRET ? new MetaLeadsClient({ appId: cfg.META_APP_ID, appSecret: cfg.META_APP_SECRET, graphVersion: cfg.META_GRAPH_VERSION, baseUrl: cfg.META_GRAPH_BASE_URL }) : undefined;
const google = cfg.GOOGLE_CLIENT_ID && cfg.GOOGLE_CLIENT_SECRET ? new GoogleClient({ clientId: cfg.GOOGLE_CLIENT_ID, clientSecret: cfg.GOOGLE_CLIENT_SECRET, tokenUrl: cfg.GOOGLE_TOKEN_URL, sheetsBase: cfg.GOOGLE_SHEETS_BASE }) : undefined;
const connDeps = { db, tokenKey: cfg.TOKEN_ENCRYPTION_KEY, meta: metaLeads, google };

export const sendQueue = new Queue('send', { connection: redis, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 } });
const eventQueue = new Queue('events', { connection: redis, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000, attempts: 6, backoff: { type: 'exponential', delay: 5000 } } });

/** Send consumer. jobId = message id, so a message can be queued only once. */
const fairShare = new RedisFairShareStore(redis);
const sendWorker = new Worker('send', async (job: Job<{ tenantId: string; messageId: string }>) => {
  const r = await sendOne({ db, graph, tokenKey: cfg.TOKEN_ENCRYPTION_KEY, appUrl: cfg.APP_URL, fairShare }, job.data.tenantId, job.data.messageId);
  if (r.kind === 'retry') { await sendQueue.add('send', job.data, { jobId: retryJobId(job.data.messageId, job.attemptsMade + 1), delay: r.delayMs }); }
  // A held message comes back at its time. The id carries the time, so a finished job can never block it.
  if (r.kind === 'deferred') { await sendQueue.add('send', job.data, { jobId: deferredJobId(job.data.messageId, r.until.getTime()), delay: Math.max(1000, r.until.getTime() - Date.now()) }); }
  return r.kind;
}, { connection: redis, concurrency: 20, limiter: { max: 80, duration: 1000 } }); // 80 messages/second is the default Cloud API per-number rate

/** Event consumer: one webhook_events row per job. Unknown routing is stored and left unprocessed for review, never guessed. */
const eventWorker = new Worker('events', async (job: Job<{ id: number }>) => {
  const row = (await db.execute(sql`select * from webhook_events where id = ${job.data.id}`) as unknown as Record<string, any>[])[0];
  return row ? processEvent(db, row, job.attemptsMade) : 'done';
}, { connection: redis, concurrency: 10 });
/** Billing consumer: one billing_events row per job; a webhook that raced ahead of our own subscription row throws and is retried with backoff. */
const billingQueue = new Queue('billing', { connection: redis, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000, attempts: 8, backoff: { type: 'exponential', delay: 5000 } } });
const billingWorker = new Worker('billing', async (job: Job<{ id: number }>) => processBillingEvent(db, job.data.id), { connection: redis, concurrency: 4 });
for (const w of [sendWorker, eventWorker, billingWorker]) w.on('failed', (j, e) => console.error(`[${w.name}] job ${j?.id} failed: ${e.message}`));

/** Outbox sweeper: anything queued in the database but missing from Redis (a crash between the two) is re-enqueued. */
async function sweepOutbox() {
  const stuck = (await db.execute(sql`select id, tenant_id from messages where direction = 'out' and status = 'queued' and wamid is null and created_at < now() - interval '3 seconds' and (not_before is null or not_before <= now()) order by coalesce(not_before, created_at) limit 500`)) as unknown as { id: string; tenant_id: string }[];
  // Plain queued messages keep jobId = id (one job ever). A message that was held and is now due gets a time-based id, because its first job already finished.
  for (const m of stuck) await sendQueue.add('send', { tenantId: m.tenant_id, messageId: m.id }, { jobId: m.id }).catch(() => undefined);
  const due = (await db.execute(sql`select id, tenant_id from messages where direction = 'out' and status = 'queued' and wamid is null and not_before is not null and not_before <= now() and not_before > now() - interval '1 day' limit 500`)) as unknown as { id: string; tenant_id: string }[];
  for (const m of due) await sendQueue.add('send', { tenantId: m.tenant_id, messageId: m.id }, { jobId: dueJobId(m.id, Date.now()) }).catch(() => undefined);
  stuck.push(...due);
  return stuck.length;
}
const sweeper = setInterval(() => sweepOutbox().catch((e) => console.error('sweep', e.message)), 5_000);

/** Launcher: every 15 s, expand campaigns that are due and queue their messages; then refresh campaign counts from the data. */
async function tick() {
  for (const c of await dueCampaigns(db)) {
    const r = await launchCampaign(db, c.tenant_id, c.id, cfg.APP_URL, cfg.NODE_ENV === 'production');
    if (r.status === 'running') for (const id of await queuedMessageIds(db, c.tenant_id, c.id)) await sendQueue.add('send', { tenantId: c.tenant_id, messageId: id }, { jobId: id }).catch(() => undefined);
    console.log(`[launcher] campaign ${c.id}: ${r.status}${r.reason ? ' (' + r.reason + ')' : ''} queued=${r.queued} skipped=${r.skipped}`);
  }
  // A/B tests: the owner chose a winner, so send it to the people who were held back.
  for (const c of await dueReleases(db)) {
    const r = await releaseWinner(db, c.tenant_id, c.id, cfg.APP_URL, cfg.NODE_ENV === 'production');
    if (r.status === 'released') for (const id of await queuedMessageIds(db, c.tenant_id, c.id)) await sendQueue.add('send', { tenantId: c.tenant_id, messageId: id }, { jobId: id }).catch(() => undefined);
    console.log(`[ab-release] campaign ${c.id}: ${r.status}${r.reason ? ' (' + r.reason + ')' : ''} queued=${r.queued} skipped=${r.skipped}`);
  }
  await rollupCampaigns(db);
}
/** Templates: send new ones to Meta, remove deleted ones, and reconcile with Meta every 6 hours. Every 20 s is cheap: each step only looks at rows waiting for it. */
async function templatesTick() {
  const d = { db, graph, tokenKey: cfg.TOKEN_ENCRYPTION_KEY, appUrl: cfg.APP_URL };
  await submitPendingTemplates(d);
  await deleteQueuedTemplates(d);
  for (const tenantId of await tenantsDueForSync(db, 360)) {
    try { const r = await syncTemplates(d, tenantId); if (r) console.log(`[templates] synced ${tenantId}: seen=${r.seen} updated=${r.updated} adopted=${r.adopted} imported=${r.imported} skipped=${r.skipped}`); }
    catch (e) { console.error('[templates] sync failed', tenantId, (e as Error).message); }
  }
}
/** Safety net: connector events that were stored but not finished (crash, Facebook outage) are retried, and sheets are read every 2 minutes. */
const connectorTimer = setInterval(async () => { for (const id of await pendingConnectorEvents(db)) await processConnectorEvent(connDeps, id); }, 20_000);
const sheetsTimer = setInterval(() => syncSheets(connDeps).then((r) => { if (r.rows || r.errors) console.log('[sheets]', JSON.stringify(r)); }).catch((e) => console.error('sheets', e.message)), cfg.SHEETS_SYNC_MS);
const templatesTimer = setInterval(() => templatesTick().catch((e) => console.error('templates', e.message)), 20_000);
const journeyTimer = setInterval(() => tickJourneys({ db, appUrl: cfg.APP_URL }).then((r) => { if (r.due) console.log('[journeys]', JSON.stringify(r)); }).catch((e) => console.error('journeys', e.message)), 10_000);
const mediaTimer = setInterval(() => tickInboundMedia({ db, graph, tokenKey: cfg.TOKEN_ENCRYPTION_KEY }).then((r) => { if (r.due) console.log('[inbound-media]', JSON.stringify(r)); }).catch((e) => console.error('inbound-media', e.message)), 10_000);
const retentionTimer = setInterval(() => runRetention(db, { days: Number(process.env.FILE_RETENTION_DAYS ?? 90) }).then((r) => { if (r.inbound || r.sent || r.orphanHeaders) console.log('[retention]', JSON.stringify(r)); }).catch((e) => console.error('retention', e.message)), 60 * 60_000);
const closureTimer = setInterval(() => closeDueWorkspaces(db).then((r) => { if (r.due) console.log('[closure]', JSON.stringify(r)); }).catch((e) => console.error('closure', e.message)), 15 * 60_000);
const launcher = setInterval(() => tick().catch((e) => console.error('launcher', e.message)), 15_000);

const app = Fastify({ bodyLimit: 8 * 1024 * 1024, trustProxy: cfg.TRUST_PROXY === 'true', logger: { level: 'info', serializers: { req: (r) => ({ method: r.method, url: String(r.url).replace(/([?&]key=)[^&]*/i, '$1***'), host: r.host, remoteAddress: r.ip }) }, redact: ['req.headers.authorization', 'req.headers["x-hub-signature-256"]', 'req.headers["x-razorpay-signature"]', 'req.headers["x-lead-key"]', 'req.headers["x-lbc-sig"]'] } });
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
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  // Facebook Page events (Lead Ads) arrive on this same URL with the same signature. Verify first, then route by object type.
  if (verifySignature(raw, req.headers['x-hub-signature-256'] as string | undefined, cfg.META_APP_SECRET)) {
    let parsed: { object?: string } | null = null;
    try { parsed = JSON.parse(raw.toString('utf8')); } catch { /* falls through to the WhatsApp path */ }
    if (parsed?.object === 'page') {
      for (const id of await ingestMetaLeadgen(db, parsed)) void processConnectorEvent(connDeps, id).catch((e) => req.log.error({ err: (e as Error).message }, 'connector event'));
      return reply.code(200).send('ok');
    }
  }
  const r = await ingestWebhook(db, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), req.headers['x-hub-signature-256'] as string | undefined, cfg.META_APP_SECRET);
  if (r.status === 401) return reply.code(401).send('bad signature');
  await Promise.all(r.items.map((i) => eventQueue.add('event', { id: i.id }, { jobId: `ev-${i.id}` }))); // fast: store, enqueue, 200
  return reply.code(200).send('ok');
});

app.post('/webhooks/shopify', async (req, reply) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const r = await ingestShopify(db, raw, req.headers, cfg.SHOPIFY_CLIENT_SECRET);
  if (r.status === 503) return reply.code(503).send('not configured');
  if (r.status === 401) return reply.code(401).send('bad signature');
  for (const id of r.ids) void processConnectorEvent(connDeps, id).catch((e) => req.log.error({ err: (e as Error).message }, 'connector event'));
  return reply.code(200).send('ok');
});

app.post('/webhooks/razorpay', async (req, reply) => {
  const r = await ingestBilling(db, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), req.headers['x-razorpay-signature'] as string | undefined, req.headers['x-razorpay-event-id'] as string | undefined, cfg.RAZORPAY_WEBHOOK_SECRET);
  if (r.status === 503) return reply.code(503).send('not configured');
  if (r.status === 401) return reply.code(401).send('bad signature');
  if (r.id !== null) await billingQueue.add('billing', { id: r.id }, { jobId: `bill-${r.id}` });
  return reply.code(200).send('ok');
});

/** Public lead capture. Browsers post here from other sites, so CORS is open; the source key (header or ?key=) and the rate limits are the protection. */
const perIp = makeLimiter(60, 60_000), perSource = makeLimiter(600, 60_000);
const leadCors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-lead-key, authorization', 'access-control-max-age': '86400' };
app.options('/leads/:id', async (_req, reply) => reply.code(204).headers(leadCors).send());
app.post('/leads/:id', async (req, reply) => {
  const id = String((req.params as { id: string }).id).slice(0, 80);
  if (!perIp(`ip:${req.ip}`) || !perSource(`src:${id}`)) return reply.code(429).headers({ ...leadCors, 'retry-after': '30' }).send({ ok: false, error: 'Too many requests. Slow down.' });
  const auth = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const key = (req.headers['x-lead-key'] as string | undefined) || auth || (req.query as Record<string, string>).key || undefined;
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const r = await ingestLead(db, id, key, raw, req.headers['content-type']);
  return reply.code(r.status).headers(leadCors).send(r.status === 200 ? { ok: true, id: r.leadId, created: r.created } : { ok: false, error: r.error });
});

/** Hosted form submissions from /f/<slug> (the page is served by the web app, the data comes here). Stricter limits than keyed sources: no key. */
const perIpForm = makeLimiter(8, 60_000), perForm = makeLimiter(120, 60_000);
app.options('/forms/:slug', async (_req, reply) => reply.code(204).headers(leadCors).send());
app.post('/forms/:slug', async (req, reply) => {
  const slug = String((req.params as { slug: string }).slug).slice(0, 60);
  if (!perIpForm(`ip:${req.ip}`) || !perForm(`form:${slug}`)) return reply.code(429).headers({ ...leadCors, 'retry-after': '30' }).send({ ok: false, error: 'Too many submissions. Please wait a minute.' });
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const r = await submitForm(db, slug, raw, req.headers['content-type']);
  return reply.code(r.status).headers(leadCors).send(r.status === 200 ? { ok: true } : { ok: false, error: r.error });
});

/** Called only by the web app, signed with INTERNAL_API_SECRET + timestamp. Not CORS-enabled and never linked from anywhere public. */
app.post('/internal/leads/import', async (req, reply) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!verifyInternal(cfg.INTERNAL_API_SECRET, raw, req.headers['x-lbc-ts'] as string | undefined, req.headers['x-lbc-sig'] as string | undefined)) return reply.code(401).send({ ok: false, error: 'unauthorised' });
  let b: { tenantId?: string; sourceId?: string; rows?: unknown };
  try { b = JSON.parse(raw); } catch { return reply.code(400).send({ ok: false, error: 'bad json' }); }
  if (!b.tenantId || !b.sourceId || !Array.isArray(b.rows) || b.rows.length > 5000) return reply.code(400).send({ ok: false, error: 'bad request' });
  try { return reply.send({ ok: true, report: await importLeads(db, b.tenantId, b.sourceId, b.rows as never) }); }
  catch (e) { if (e instanceof ImportSourceNotFound) return reply.code(404).send({ ok: false, error: 'source not found' }); req.log.error({ err: (e as Error).message }, 'lead import failed'); return reply.code(500).send({ ok: false, error: 'import failed' }); }
});

await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
const stop = async () => { clearInterval(sweeper); clearInterval(mediaTimer); clearInterval(retentionTimer); clearInterval(closureTimer); clearInterval(launcher); clearInterval(templatesTimer); clearInterval(connectorTimer); clearInterval(sheetsTimer); await app.close(); await Promise.all([sendWorker.close(), eventWorker.close(), billingWorker.close()]); await redis.quit(); await client.end(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
