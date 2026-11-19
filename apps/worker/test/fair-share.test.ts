import { createServer, type Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { createDb } from '@lbc/db';
import { GraphClient, encryptSecret } from '@lbc/meta';
import { MemoryFairShareStore, decide } from '@lbc/shared/fair-share';
import { sendOne } from '../src/send';
import { RedisFairShareStore } from '../src/fair-share-redis';

/**
 * The fair-share rule inside the real send path (sendOne) and against a real Redis. A fake Meta counts what really leaves.
 */
const w = createDb(process.env.DATABASE_URL_WORKER ?? 'postgres://worker:worker_dev_password@localhost:5433/leadbotcloud', { max: 3 });
const admin = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? 'postgres://postgres:postgres_dev_password@localhost:5433/leadbotcloud', { max: 2 });
const db = w.db; const KEY = randomBytes(32).toString('base64');
const rows = (r: unknown) => r as Record<string, any>[];
let server: Server, base = ''; let metaCalls = 0;
beforeAll(async () => {
  server = createServer((req, res) => { req.on('data', () => undefined); req.on('end', () => { metaCalls++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.' + randomUUID() }] })); }); });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise((ok) => server.close(ok));
  await admin.client.unsafe(`delete from tenants where name like 'FR %'`);
  const left = rows(await admin.client.unsafe(`select count(*)::int n from tenants where name like 'FR %'`))[0]!.n;
  await Promise.all([w.client.end(), admin.client.end()]);
  if (Number(left) !== 0) throw new Error('fair-share test left workspaces behind');
});
const graph = () => new GraphClient({ graphVersion: 'v26.0', baseUrl: base, appId: 'A', appSecret: 'S', timeoutMs: 3000 });

async function workspace() {
  const tenant = randomUUID(), tag = tenant.slice(0, 8), pn = `fr-pn-${tag}`;
  await admin.client.unsafe(`insert into tenants (id, name) values ('${tenant}', 'FR ${tag}')`);
  await db.execute(sql`insert into meta_accounts (tenant_id, messaging_account_id, business_token_enc, token_status, health_state) values (${tenant}, ${'fr-waba-' + tag}, ${encryptSecret('T-' + tag, KEY)}, 'valid', 'ok')`);
  const acc = rows(await db.execute(sql`select id from meta_accounts where tenant_id = ${tenant}`))[0]!;
  await db.execute(sql`insert into phone_numbers (tenant_id, meta_account_id, phone_number_id, display_phone_number) values (${tenant}, ${acc.id}, ${pn}, '+91 98765 43210')`);
  return { tenant, pn };
}
/** A plain text chat message (a person typed it) or a bulk message tied to a campaign recipient. */
async function message(ws: { tenant: string; pn: string }, bulk: boolean) {
  const c = rows(await db.execute(sql`insert into contacts (tenant_id, phone_e164, consent_status) values (${ws.tenant}, ${'+9198' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}, 'allowed') returning id`))[0]!;
  const v = rows(await db.execute(sql`insert into conversations (tenant_id, contact_id, status, window_expires_at, phone_number_id) values (${ws.tenant}, ${c.id}, 'open', ${new Date(Date.now() + 3600_000).toISOString()}::timestamptz, ${ws.pn}) returning id`))[0]!;
  const id = randomUUID(); let recipient: string | null = null;
  if (bulk) {
    const camp = rows(await db.execute(sql`insert into campaigns (tenant_id, name, status) values (${ws.tenant}, 'FR bulk', 'running') returning id`))[0]!;
    recipient = rows(await db.execute(sql`insert into campaign_recipients (tenant_id, campaign_id, contact_id, phone_e164, state) values (${ws.tenant}, ${camp.id}, ${c.id}, '+919811100000', 'queued') returning id`))[0]!.id;
  }
  await db.execute(sql`insert into messages (id, tenant_id, conversation_id, direction, kind, body, status, phone_number_id, campaign_recipient_id) values (${id}, ${ws.tenant}, ${v.id}, 'out', 'text', 'hello', 'queued', ${ws.pn}, ${recipient})`);
  return id;
}
const status = async (id: string) => rows(await db.execute(sql`select status, wamid from messages where id = ${id}`))[0]!;

describe('fair share inside the real send path', () => {
  it('a bulk message over the workspace share is deferred about a second, stays queued, and never reaches Meta', async () => {
    const A = await workspace(), B = await workspace(); const store = new MemoryFairShareStore();
    const d = () => ({ db, graph: graph(), tokenKey: KEY, fairShare: store, now: () => new Date(1_700_000_000_000) });
    await decide(store, B.tenant, 'bulk', 1_700_000_000_000);                       // B is sending this second, so A is held to its share
    for (let i = 0; i < 20; i++) await decide(store, A.tenant, 'bulk', 1_700_000_000_000);   // A has already used far more than its share this second
    metaCalls = 0; const id = await message(A, true);
    const r = await sendOne(d(), A.tenant, id);
    expect(r.kind).toBe('deferred'); if (r.kind === 'deferred') { expect(r.why).toBe('fair_share'); expect(r.until.getTime() - 1_700_000_000_000).toBe(1000); }
    expect(metaCalls).toBe(0); const s = await status(id); expect(s.status).toBe('queued'); expect(s.wamid).toBeNull();     // untouched, ready to go again
  });

  it('the same moment, a chat message from the same workspace goes straight out', async () => {
    const A = await workspace(), B = await workspace(); const store = new MemoryFairShareStore();
    const d = () => ({ db, graph: graph(), tokenKey: KEY, fairShare: store, now: () => new Date(1_700_000_000_000) });
    await decide(store, B.tenant, 'bulk', 1_700_000_000_000); for (let i = 0; i < 20; i++) await decide(store, A.tenant, 'bulk', 1_700_000_000_000);
    metaCalls = 0; const id = await message(A, false);
    const r = await sendOne(d(), A.tenant, id); expect(r.kind).toBe('sent'); expect(metaCalls).toBe(1); expect((await status(id)).wamid).toMatch(/^wamid\./);
  });

  it('a deferred bulk message is sent on the next try once the second has passed, and only once', async () => {
    const A = await workspace(), B = await workspace(); const store = new MemoryFairShareStore(); let t = 1_700_000_000_000;
    const d = () => ({ db, graph: graph(), tokenKey: KEY, fairShare: store, now: () => new Date(t) });
    await decide(store, B.tenant, 'bulk', t); for (let i = 0; i < 20; i++) await decide(store, A.tenant, 'bulk', t);
    const id = await message(A, true); metaCalls = 0;
    expect((await sendOne(d(), A.tenant, id)).kind).toBe('deferred'); expect(metaCalls).toBe(0);
    t += 1000; await decide(store, B.tenant, 'bulk', t);                            // still busy next second, but A starts a fresh share
    expect((await sendOne(d(), A.tenant, id)).kind).toBe('sent'); expect(metaCalls).toBe(1);
    expect((await sendOne(d(), A.tenant, id)).kind).toBe('skipped'); expect(metaCalls).toBe(1);                              // never twice
  });

  it('with no fair-share store configured nothing changes (the single-process default)', async () => {
    const A = await workspace(); metaCalls = 0; const id = await message(A, true);
    expect((await sendOne({ db, graph: graph(), tokenKey: KEY }, A.tenant, id)).kind).toBe('sent'); expect(metaCalls).toBe(1);
  });

  it('a message that is not due yet (campaign speed) is deferred for speed and does NOT use up the workspace share', async () => {
    const A = await workspace(); const store = new MemoryFairShareStore(); const now = 1_700_000_000_000;
    const d = () => ({ db, graph: graph(), tokenKey: KEY, fairShare: store, now: () => new Date(now) });
    const id = await message(A, true); await db.execute(sql`update messages set not_before = ${new Date(now + 60_000).toISOString()}::timestamptz where id = ${id}`);
    const r = await sendOne(d(), A.tenant, id); expect(r.kind).toBe('deferred'); if (r.kind === 'deferred') expect(r.why).toBe('speed');
    expect(await store.bump(A.tenant, Math.floor(now / 1000))).toBe(1);               // the only count is this probe: the deferred message used none
  });
});

describe('the Redis counters (real Redis)', () => {
  let redis: Redis;
  beforeAll(() => { redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380', { maxRetriesPerRequest: 2 }); });
  afterAll(async () => { await redis.quit(); });

  it('counts per workspace per second, sees other workspaces, expires on its own, and two stores agree', async () => {
    const prefix = 'fs-test-' + randomUUID().slice(0, 6); const a = new RedisFairShareStore(redis, prefix); const b = new RedisFairShareStore(redis, prefix);   // two workers
    const sec = Math.floor(Date.now() / 1000);
    expect(await a.bump('T1', sec)).toBe(1); expect(await b.bump('T1', sec)).toBe(2); expect(await a.bump('T2', sec)).toBe(1);   // shared between the two
    expect(await a.othersActive('T1', sec)).toBe(1); expect(await b.othersActive('T3', sec)).toBe(2); expect(await a.othersActive('T1', sec + 1)).toBe(0);
    const ttl = await redis.ttl(`${prefix}:${sec}`); expect(ttl).toBeGreaterThan(0); expect(ttl).toBeLessThanOrEqual(10);       // cleans itself up
    await redis.del(`${prefix}:${sec}`);
  });

  it('the whole rule works through Redis: a flooding workspace is held while a quiet one is not', async () => {
    const prefix = 'fs-test-' + randomUUID().slice(0, 6); const s = new RedisFairShareStore(redis, prefix); const now = Date.now();
    const cfg = { budgetPerSecond: 10, sharePerSecond: 3, retryAfterMs: 1000 };
    expect((await decide(s, 'quiet', 'bulk', now, cfg)).allow).toBe(true);
    const flood: boolean[] = []; for (let i = 0; i < 8; i++) flood.push((await decide(s, 'flood', 'bulk', now, cfg)).allow);
    expect(flood.filter(Boolean).length).toBe(3); expect((await decide(s, 'quiet', 'bulk', now, cfg)).allow).toBe(true);
    for (const k of await redis.keys(`${prefix}:*`)) await redis.del(k);
  });
});
