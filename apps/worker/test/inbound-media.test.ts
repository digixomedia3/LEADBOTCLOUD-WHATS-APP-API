import { createServer, type Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '@lbc/db';
import { GraphClient, encryptSecret } from '@lbc/meta';
import { handleInbound } from '../src/handlers';
import { tickInboundMedia } from '../src/inbound-media';

const WORKER_URL = process.env.DATABASE_URL_WORKER ?? 'postgres://worker:worker_dev_password@localhost:5433/leadbotcloud';
const ADMIN_URL = process.env.DATABASE_URL_ADMIN_TEST ?? 'postgres://postgres:postgres_dev_password@localhost:5433/leadbotcloud';
const w = createDb(WORKER_URL, { max: 4 });
const admin = createDb(ADMIN_URL, { max: 2 });
const db = w.db;
const KEY = randomBytes(32).toString('base64');
const rows = (r: unknown) => r as Record<string, any>[];

// ---- fake Meta: one route gives the link, one serves the bytes ----
type Hit = { path: string; auth?: string | undefined };
const hits: Hit[] = [];
let server: Server, base = '';
let infoDelayMs = 0;
let infoReply: (id: string) => { status: number; body: unknown } = (id) => ({ status: 200, body: { id, url: `${base}/files/${id}`, mime_type: 'image/jpeg', file_size: 5 } });
let fileReply: (id: string) => { status: number; type?: string; bytes?: Buffer; length?: number } = () => ({ status: 200, type: 'image/jpeg', bytes: Buffer.from('JPEG!') });
beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push({ path: req.url ?? '', auth: req.headers.authorization });
    const url = req.url ?? '';
    if (url.startsWith('/files/')) {
      const r = fileReply(url.slice(7));
      res.writeHead(r.status, { 'content-type': r.type ?? 'application/octet-stream', ...(r.length !== undefined ? { 'content-length': String(r.length) } : {}) });
      res.end(r.bytes ?? Buffer.alloc(0)); return;
    }
    const m = /\/v26\.0\/([^/?]+)$/.exec(url.split('?')[0]!);
    const r = infoReply(m?.[1] ?? '');
    setTimeout(() => { res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(r.body)); }, infoDelayMs);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise((ok) => server.close(ok));
  await admin.client.unsafe(`delete from tenants where name like 'IM %'`);
  await Promise.all([w.client.end(), admin.client.end()]);
});
const graph = () => new GraphClient({ graphVersion: 'v26.0', baseUrl: base, appId: 'APP', appSecret: 'S', timeoutMs: 3000 });
const deps = () => ({ db, graph: graph(), tokenKey: KEY });

interface Fx { tenant: string; pn: string; phone: string; token: string }
async function fixture(connected = true): Promise<Fx> {
  // The tick is not scoped to one workspace, so park every file left over from earlier tests before this one starts.
  await admin.client.unsafe(`update inbound_media set next_try_at = now() + interval '1 day' where state = 'pending'`);
  const tenant = randomUUID(), tag = tenant.slice(0, 8), pn = `im-pn-${tag}`, token = `TOKEN-${tag}`;
  const phone = `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  await admin.client.unsafe(`insert into tenants (id, name, quiet_hours_enabled) values ('${tenant}', 'IM ${tag}', false)`);
  if (connected) await db.execute(sql`insert into meta_accounts (tenant_id, messaging_account_id, business_token_enc, token_status, health_state) values (${tenant}, ${'im-waba-' + tag}, ${encryptSecret(token, KEY)}, 'valid', 'ok')`);
  return { tenant, pn, phone, token };
}
const inbound = (fx: Fx, m: Record<string, unknown>) => handleInbound(db, fx.tenant, fx.pn, { id: `wamid.in.${randomUUID()}`, from: fx.phone.slice(1), timestamp: String(Math.floor(Date.now() / 1000)), ...m } as never);
const media = async (fx: Fx) => rows(await db.execute(sql`select * from inbound_media where tenant_id = ${fx.tenant} order by created_at`));
const makeDue = (fx: Fx) => admin.client.unsafe(`update inbound_media set next_try_at = now() - interval '1 second' where tenant_id = '${fx.tenant}'`);

describe('a customer sends a file: what is recorded', () => {
  it('a photo makes a message that reads like a photo, plus one pending download', async () => {
    const fx = await fixture();
    await inbound(fx, { type: 'image', image: { id: 'MEDIA1', mime_type: 'image/jpeg', caption: 'my receipt' } });
    const m = rows(await db.execute(sql`select kind, body from messages where tenant_id = ${fx.tenant}`))[0]!;
    expect(m.kind).toBe('image'); expect(m.body).toBe('Photo: my receipt');
    const f = (await media(fx))[0]!;
    expect(f.state).toBe('pending'); expect(f.meta_media_id).toBe('MEDIA1'); expect(f.caption).toBe('my receipt'); expect(f.kind).toBe('image');
  });
  it('a voice note, a document with a name, and a location all get a readable line', async () => {
    const fx = await fixture();
    await inbound(fx, { type: 'audio', audio: { id: 'A1', mime_type: 'audio/ogg; codecs=opus' } });
    await inbound(fx, { type: 'document', document: { id: 'D1', filename: 'quote.pdf', mime_type: 'application/pdf' } });
    await inbound(fx, { type: 'location', location: { latitude: 28.6, longitude: 77.2, name: 'Shop' } });
    const bodies = rows(await db.execute(sql`select body from messages where tenant_id = ${fx.tenant} order by created_at, id`)).map((r) => r.body).sort();
    expect(bodies).toEqual(['Document: quote.pdf', 'Location: Shop', '[Voice message]']);
    expect((await media(fx)).length).toBe(2);   // location has no file
  });
  it('a replayed webhook makes no second download and no second unread count', async () => {
    const fx = await fixture();
    const msg = { id: 'wamid.same', type: 'image', image: { id: 'MEDIA2' } };
    await inbound(fx, msg); await inbound(fx, msg);
    expect((await media(fx)).length).toBe(1);
    expect(Number(rows(await db.execute(sql`select unread from conversations where tenant_id = ${fx.tenant}`))[0]!.unread)).toBe(1);
  });
  it('an emoji reaction is not a message: nothing stored, nothing unread', async () => {
    const fx = await fixture();
    await inbound(fx, { type: 'text', text: { body: 'hello' } });
    const r = await inbound(fx, { type: 'reaction', reaction: { message_id: 'wamid.x', emoji: '👍' } });
    expect(r.outcome).toBe('ignored');
    expect(Number(rows(await db.execute(sql`select count(*)::int as n from messages where tenant_id = ${fx.tenant}`))[0]!.n)).toBe(1);
    expect(Number(rows(await db.execute(sql`select unread from conversations where tenant_id = ${fx.tenant}`))[0]!.unread)).toBe(1);
  });
  it('a media id that could be abused in a URL is not trusted: the message is kept, no download is queued', async () => {
    const fx = await fixture();
    await inbound(fx, { type: 'image', image: { id: '../../admin?x=1' } });
    expect(Number(rows(await db.execute(sql`select count(*)::int as n from messages where tenant_id = ${fx.tenant}`))[0]!.n)).toBe(1);
    expect((await media(fx)).length).toBe(0);
  });
  it('a file in a STOP-less chat does not change consent or trigger keyword replies', async () => {
    const fx = await fixture();
    const r = await inbound(fx, { type: 'image', image: { id: 'M9', caption: 'STOP' } });
    expect(r.optedOut).toBeFalsy();   // a caption is not the customer typing STOP
  });
});

describe('downloading the file', () => {
  it('fetches with THIS workspace token, stores the bytes and the real type', async () => {
    const fx = await fixture(); hits.length = 0;
    await inbound(fx, { type: 'image', image: { id: 'MEDIA-OK', mime_type: 'image/png' } });
    const t = await tickInboundMedia(deps());
    expect(t.stored).toBe(1);
    const f = (await media(fx))[0]!;
    expect(f.state).toBe('stored'); expect(Buffer.from(f.data).toString()).toBe('JPEG!'); expect(f.size_bytes).toBe(5);
    expect(f.mime).toBe('image/jpeg');   // Meta's answer wins over the customer's claim
    expect(hits.every((h) => h.auth === `Bearer ${fx.token}`)).toBe(true);
    expect(hits.map((h) => h.path)).toEqual(expect.arrayContaining(['/v26.0/MEDIA-OK', '/files/MEDIA-OK']));
  });
  it('a stored file is not fetched again', async () => {
    const fx = await fixture(); await inbound(fx, { type: 'image', image: { id: 'ONCE' } });
    await tickInboundMedia(deps()); hits.length = 0;
    await makeDue(fx); expect((await tickInboundMedia(deps())).due).toBe(0); expect(hits.length).toBe(0);
  });
  it('two workers at once never fetch the same file twice', async () => {
    const fx = await fixture(); hits.length = 0;
    await inbound(fx, { type: 'image', image: { id: 'RACE' } });
    const [a, b] = await Promise.all([tickInboundMedia(deps()), tickInboundMedia(deps())]);
    expect(a.stored + b.stored).toBe(1);
    expect(hits.filter((h) => h.path.startsWith('/files/RACE')).length).toBe(1);
  });
  it('a temporary Meta error is retried later with a growing wait, then succeeds', async () => {
    const fx = await fixture(); await inbound(fx, { type: 'image', image: { id: 'FLAKY' } });
    infoReply = () => ({ status: 500, body: { error: { message: 'oops' } } });
    const t1 = await tickInboundMedia(deps()); expect(t1.retrying).toBe(1);
    let f = (await media(fx))[0]!; expect(f.state).toBe('pending'); expect(f.attempts).toBe(1);
    expect(new Date(f.next_try_at).getTime()).toBeGreaterThan(Date.now() + 20_000);   // not retried at once
    expect((await tickInboundMedia(deps())).due).toBe(0);
    infoReply = (id) => ({ status: 200, body: { id, url: `${base}/files/${id}`, mime_type: 'image/jpeg' } });
    await makeDue(fx); expect((await tickInboundMedia(deps())).stored).toBe(1);
    f = (await media(fx))[0]!; expect(f.state).toBe('stored'); expect(f.error).toBeNull();
  });
  it('a missing file (404) fails for good at once, with a reason', async () => {
    const fx = await fixture(); await inbound(fx, { type: 'image', image: { id: 'GONE' } });
    infoReply = () => ({ status: 404, body: { error: { message: 'Media not found' } } });
    expect((await tickInboundMedia(deps())).failed).toBe(1);
    const f = (await media(fx))[0]!; expect(f.state).toBe('failed'); expect(f.error).toMatch(/not found/i);
    infoReply = (id) => ({ status: 200, body: { id, url: `${base}/files/${id}` } });
  });
  it('after 5 tries it gives up instead of trying forever', async () => {
    const fx = await fixture(); await inbound(fx, { type: 'image', image: { id: 'DOWN' } });
    infoReply = () => ({ status: 503, body: {} });
    for (let i = 0; i < 5; i++) { await makeDue(fx); await tickInboundMedia(deps()); }
    const f = (await media(fx))[0]!; expect(f.state).toBe('failed'); expect(f.attempts).toBe(5);
    await makeDue(fx); expect((await tickInboundMedia(deps())).due).toBe(0);
    infoReply = (id) => ({ status: 200, body: { id, url: `${base}/files/${id}` } });
  });
  it('a file over 16 MB is refused by its announced size, and not downloaded', async () => {
    const fx = await fixture(); hits.length = 0; await inbound(fx, { type: 'video', video: { id: 'BIG' } });
    infoReply = (id) => ({ status: 200, body: { id, url: `${base}/files/${id}`, mime_type: 'video/mp4', file_size: 17 * 1024 * 1024 } });
    expect((await tickInboundMedia(deps())).tooLarge).toBe(1);
    expect((await media(fx))[0]!.state).toBe('too_large'); expect(hits.some((h) => h.path.startsWith('/files/'))).toBe(false);
    infoReply = (id) => ({ status: 200, body: { id, url: `${base}/files/${id}`, mime_type: 'image/jpeg', file_size: 5 } });
  });
  it('a server that lies about the size is stopped while reading', async () => {
    const fx = await fixture(); await inbound(fx, { type: 'video', video: { id: 'LIAR' } });
    infoReply = (id) => ({ status: 200, body: { id, url: `${base}/files/${id}`, mime_type: 'video/mp4', file_size: 100 } });
    fileReply = () => ({ status: 200, type: 'video/mp4', bytes: Buffer.alloc(17 * 1024 * 1024, 1) });
    expect((await tickInboundMedia(deps())).tooLarge).toBe(1);
    expect((await media(fx))[0]!.state).toBe('too_large');
    fileReply = () => ({ status: 200, type: 'image/jpeg', bytes: Buffer.from('JPEG!') });
    infoReply = (id) => ({ status: 200, body: { id, url: `${base}/files/${id}`, mime_type: 'image/jpeg', file_size: 5 } });
  });
  it('an empty file is not stored as success', async () => {
    const fx = await fixture(); await inbound(fx, { type: 'image', image: { id: 'EMPTY' } });
    fileReply = () => ({ status: 200, type: 'image/jpeg', bytes: Buffer.alloc(0) });
    await tickInboundMedia(deps()); expect((await media(fx))[0]!.state).not.toBe('stored');
    fileReply = () => ({ status: 200, type: 'image/jpeg', bytes: Buffer.from('JPEG!') });
  });
  it('the token is never sent to a link that is not Meta (a poisoned reply cannot steal it)', async () => {
    const fx = await fixture(); hits.length = 0; await inbound(fx, { type: 'image', image: { id: 'EVIL' } });
    infoReply = (id) => ({ status: 200, body: { id, url: 'https://evil.example.com/steal', mime_type: 'image/jpeg' } });
    await tickInboundMedia(deps());
    expect((await media(fx))[0]!.state).not.toBe('stored'); expect(hits.length).toBe(1);   // only the link lookup reached our fake Meta
    infoReply = (id) => ({ status: 200, body: { id, url: `${base}/files/${id}`, mime_type: 'image/jpeg', file_size: 5 } });
  });
  it('a workspace that is not connected does not crash and does not use another workspace token', async () => {
    const fx = await fixture(false); hits.length = 0; await inbound(fx, { type: 'image', image: { id: 'NOACC' } });
    const t = await tickInboundMedia(deps());
    expect(t.stored).toBe(0); expect(hits.length).toBe(0);
    const f = (await media(fx))[0]!; expect(f.state).toBe('pending'); expect(f.error).toMatch(/not connected/i); expect(f.error).not.toMatch(/unexpected/i);
  });
  it('each workspace gets its own file even when the media id is the same', async () => {
    const a = await fixture(), b = await fixture(); hits.length = 0;
    await inbound(a, { type: 'image', image: { id: 'SHARED' } }); await inbound(b, { type: 'image', image: { id: 'SHARED' } });
    await tickInboundMedia(deps(), 20);
    const auths = hits.filter((h) => h.path === '/v26.0/SHARED').map((h) => h.auth).sort();
    expect(auths).toEqual([`Bearer ${a.token}`, `Bearer ${b.token}`].sort());
  });
});

describe('many files and many workers', () => {
  it('a second pass while a download is still running does not fetch that file again', async () => {
    const fx = await fixture(); hits.length = 0; await inbound(fx, { type: 'image', image: { id: 'SLOW' } });
    infoDelayMs = 700;
    const first = tickInboundMedia(deps());
    await new Promise((r) => setTimeout(r, 250));
    const second = await tickInboundMedia(deps());   // while the first is mid-download
    await first; infoDelayMs = 0;
    expect(second.due).toBe(0);
    expect(hits.filter((h) => h.path === '/v26.0/SLOW').length).toBe(1);
  });
  it('4 workers sharing 12 files: every file fetched exactly once', async () => {
    const fx = await fixture(); hits.length = 0;
    for (let i = 0; i < 12; i++) await inbound(fx, { type: 'image', image: { id: `BULK${i}` } });
    const r = await Promise.all([1, 2, 3, 4].map(() => tickInboundMedia(deps(), 5)));
    expect(r.reduce((n, x) => n + x.stored, 0)).toBe(12);
    for (let i = 0; i < 12; i++) expect(hits.filter((h) => h.path === `/v26.0/BULK${i}`).length, `BULK${i}`).toBe(1);
  });
});
