import { createServer, type Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '@lbc/db';
import { GraphClient, encryptSecret } from '@lbc/meta';
import { sendOne } from '../src/send';

const w = createDb(process.env.DATABASE_URL_WORKER ?? 'postgres://worker:worker_dev_password@localhost:5433/leadbotcloud', { max: 4 });
const admin = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? 'postgres://postgres:postgres_dev_password@localhost:5433/leadbotcloud', { max: 2 });
const db = w.db; const KEY = randomBytes(32).toString('base64');
const rows = (r: unknown) => r as Record<string, any>[];

// ---- fake Meta: records uploads and sends, and can be told to fail ----
type Call = { path: string; auth?: string | undefined; ctype?: string | undefined; json?: any; bytes?: number; form?: string };
const calls: Call[] = [];
let server: Server, base = '';
let uploadReply: () => { status: number; body: unknown } | 'hangup' = () => ({ status: 200, body: { id: 'UPLOADED-' + randomUUID().slice(0, 6) } });
const okSend = () => ({ status: 200, body: { messaging_product: 'whatsapp', messages: [{ id: 'wamid.' + randomUUID() }] } });
let sendReply: () => { status: number; body: unknown } = okSend;
beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks); const url = req.url ?? '';
      const c: Call = { path: url, auth: req.headers.authorization, ctype: req.headers['content-type'], bytes: raw.length };
      if (url.endsWith('/media')) { c.form = raw.toString('latin1'); calls.push(c); const r = uploadReply(); if (r === 'hangup') { req.socket.destroy(); return; } res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(r.body)); return; }
      try { c.json = JSON.parse(raw.toString('utf8') || '{}'); } catch { /* not json */ }
      calls.push(c); const r = sendReply(); res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise((ok) => server.close(ok));
  await admin.client.unsafe(`delete from tenants where name like 'FS %'`);
  await Promise.all([w.client.end(), admin.client.end()]);
});
const graph = () => new GraphClient({ graphVersion: 'v26.0', baseUrl: base, appId: 'A', appSecret: 'S', timeoutMs: 3000 });
const deps = () => ({ db, graph: graph(), tokenKey: KEY });

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9]);
interface Fx { tenant: string; pn: string; conv: string; contact: string; token: string }
async function fixture(o: { window?: boolean; consent?: string; connected?: boolean } = {}): Promise<Fx> {
  const tenant = randomUUID(), tag = tenant.slice(0, 8), pn = `fs-pn-${tag}`, token = `TOKEN-${tag}`;
  await admin.client.unsafe(`insert into tenants (id, name) values ('${tenant}', 'FS ${tag}')`);
  if (o.connected !== false) {
    await db.execute(sql`insert into meta_accounts (tenant_id, messaging_account_id, business_token_enc, token_status, health_state) values (${tenant}, ${'fs-waba-' + tag}, ${encryptSecret(token, KEY)}, 'valid', 'ok')`);
    const acc = rows(await db.execute(sql`select id from meta_accounts where tenant_id = ${tenant}`))[0]!;
    await db.execute(sql`insert into phone_numbers (tenant_id, meta_account_id, phone_number_id, display_phone_number) values (${tenant}, ${acc.id}, ${pn}, '+91 98765 43210')`);
  }
  const c = rows(await db.execute(sql`insert into contacts (tenant_id, phone_e164, consent_status) values (${tenant}, ${'+9198' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}, ${o.consent ?? 'allowed'}) returning id`))[0]!;
  const exp = o.window === false ? new Date(Date.now() - 3600_000) : new Date(Date.now() + 3600_000);
  const v = rows(await db.execute(sql`insert into conversations (tenant_id, contact_id, status, window_expires_at, phone_number_id) values (${tenant}, ${c.id}, 'open', ${exp.toISOString()}::timestamptz, ${pn}) returning id`))[0]!;
  return { tenant, pn, conv: String(v.id), contact: String(c.id), token };
}
async function fileMsg(fx: Fx, o: { kind?: string; caption?: string; fileName?: string; mime?: string; noFile?: boolean; bytes?: Buffer } = {}) {
  const id = randomUUID(); const kind = o.kind ?? 'image';
  await db.execute(sql`insert into messages (id, tenant_id, conversation_id, direction, kind, body, status, phone_number_id, payload) values (${id}, ${fx.tenant}, ${fx.conv}, 'out', ${kind}, 'x', 'queued', ${fx.pn}, ${JSON.stringify(o.caption ? { caption: o.caption } : {})}::jsonb)`);
  if (!o.noFile) { const b = o.bytes ?? PNG; await db.execute(sql`insert into message_attachments (tenant_id, message_id, kind, mime, file_name, size_bytes, sha256, data) values (${fx.tenant}, ${id}, ${kind}, ${o.mime ?? 'image/png'}, ${o.fileName ?? 'saree.png'}, ${b.length}, 'x', ${b})`); }
  return id;
}
const msg = async (id: string) => rows(await db.execute(sql`select * from messages where id = ${id}`))[0]!;
const att = async (id: string) => rows(await db.execute(sql`select * from message_attachments where message_id = ${id}`))[0]!;
const uploads = () => calls.filter((c) => c.path.endsWith('/media'));
const sends = () => calls.filter((c) => c.path.endsWith('/messages'));

describe('sending a file typed into a chat', () => {
  it('uploads the file to this number with this workspace token, then sends it by id with the caption', async () => {
    const fx = await fixture(); calls.length = 0; uploadReply = () => ({ status: 200, body: { id: 'MID-ONE' } });
    const id = await fileMsg(fx, { caption: 'Your saree' });
    const r = await sendOne(deps(), fx.tenant, id);
    expect(r.kind).toBe('sent');
    expect(uploads().length).toBe(1); expect(uploads()[0]!.path).toBe(`/v26.0/${fx.pn}/media`); expect(uploads()[0]!.auth).toBe(`Bearer ${fx.token}`);
    expect(uploads()[0]!.form).toContain('image/png');
    const s = sends()[0]!; expect(s.path).toBe(`/v26.0/${fx.pn}/messages`); expect(s.auth).toBe(`Bearer ${fx.token}`);
    expect(s.json).toMatchObject({ messaging_product: 'whatsapp', type: 'image', image: { id: 'MID-ONE', caption: 'Your saree' }, biz_opaque_callback_data: `msg:${id}` });
    expect(s.json.to).toMatch(/^\+91/);
    const m = await msg(id); expect(m.status).toBe('accepted'); expect(m.wamid).toMatch(/^wamid\./); expect(m.send_path).toBe('cloud_api');
  });
  it('a document is sent with its file name, a picture without one', async () => {
    const fx = await fixture(); calls.length = 0;
    const pdf = Buffer.from('%PDF-1.4 fake');
    const id = await fileMsg(fx, { kind: 'document', mime: 'application/pdf', fileName: 'Quote March.pdf', bytes: pdf });
    await sendOne(deps(), fx.tenant, id);
    expect(sends()[0]!.json.document).toMatchObject({ filename: 'Quote March.pdf' }); expect(sends()[0]!.json.type).toBe('document');
  });
  it('the Meta media id is cached per number, so a retry never uploads twice', async () => {
    const fx = await fixture(); calls.length = 0; uploadReply = () => ({ status: 200, body: { id: 'MID-CACHE' } });
    const id = await fileMsg(fx);
    sendReply = () => ({ status: 500, body: { error: { message: 'oops', code: 131000 } } });
    const first = await sendOne(deps(), fx.tenant, id); expect(first.kind).not.toBe('sent');
    expect((await att(id)).media_ids[fx.pn].id).toBe('MID-CACHE');
    await db.execute(sql`update messages set status = 'queued', wamid = null where id = ${id}`);
    sendReply = okSend;
    await sendOne(deps(), fx.tenant, id);
    sendReply = okSend;
    expect(uploads().length).toBe(1);   // uploaded once across both tries
    expect(sends().at(-1)!.json.image.id).toBe('MID-CACHE');
  });
  it('an old cached id (over 25 days) is not trusted: the file is uploaded again', async () => {
    const fx = await fixture(); calls.length = 0; uploadReply = () => ({ status: 200, body: { id: 'MID-FRESH' } });
    const id = await fileMsg(fx);
    await db.execute(sql`update message_attachments set media_ids = ${JSON.stringify({ [fx.pn]: { id: 'MID-STALE', at: new Date(Date.now() - 26 * 86400_000).toISOString() } })}::jsonb where message_id = ${id}`);
    await sendOne(deps(), fx.tenant, id);
    expect(uploads().length).toBe(1); expect(sends()[0]!.json.image.id).toBe('MID-FRESH');
  });
  it('a recent cached id is reused without uploading', async () => {
    const fx = await fixture(); calls.length = 0;
    const id = await fileMsg(fx);
    await db.execute(sql`update message_attachments set media_ids = ${JSON.stringify({ [fx.pn]: { id: 'MID-GOOD', at: new Date().toISOString() } })}::jsonb where message_id = ${id}`);
    await sendOne(deps(), fx.tenant, id);
    expect(uploads().length).toBe(0); expect(sends()[0]!.json.image.id).toBe('MID-GOOD');
  });
  it('a temporary upload error queues a retry and sends nothing', async () => {
    const fx = await fixture(); calls.length = 0; uploadReply = () => ({ status: 503, body: {} });
    const id = await fileMsg(fx); const r = await sendOne(deps(), fx.tenant, id);
    expect(r.kind).toBe('retry'); expect(sends().length).toBe(0); expect((await msg(id)).status).toBe('queued');
    uploadReply = () => ({ status: 200, body: { id: 'MID-AFTER' } });
    expect((await sendOne(deps(), fx.tenant, id)).kind).toBe('sent');
  });
  it('an upload where Meta hangs up is retried, never marked failed and never sent twice', async () => {
    const fx = await fixture(); calls.length = 0; uploadReply = () => 'hangup';
    const id = await fileMsg(fx); const r = await sendOne(deps(), fx.tenant, id);
    expect(r.kind).toBe('retry'); expect(sends().length).toBe(0); uploadReply = () => ({ status: 200, body: { id: 'MID-B' } });
  });
  it('a refusal from Meta marks the message failed with a reason and does not loop', async () => {
    const fx = await fixture(); calls.length = 0; uploadReply = () => ({ status: 400, body: { error: { message: 'Unsupported file', code: 131053 } } });
    const id = await fileMsg(fx); const r = await sendOne(deps(), fx.tenant, id);
    expect(r.kind).toBe('failed'); expect((await msg(id)).status).toBe('failed'); expect(sends().length).toBe(0);
    uploadReply = () => ({ status: 200, body: { id: 'MID-C' } });
  });
  it('a missing file (message without its attachment) is skipped, not sent as an empty message', async () => {
    const fx = await fixture(); calls.length = 0; const id = await fileMsg(fx, { noFile: true });
    const r = await sendOne(deps(), fx.tenant, id); expect(r.kind).toBe('skipped'); expect(calls.length).toBe(0);
  });
  it('the 24-hour window is checked again at send time: a file queued before it closed is not sent', async () => {
    const fx = await fixture({ window: false }); calls.length = 0; const id = await fileMsg(fx);
    const r = await sendOne(deps(), fx.tenant, id); expect(r.kind).toBe('skipped'); expect(calls.length).toBe(0);
  });
  it('a customer who opted out after the file was queued gets nothing', async () => {
    const fx = await fixture(); calls.length = 0; const id = await fileMsg(fx);
    await db.execute(sql`update contacts set consent_status = 'stopped' where id = ${fx.contact}`);
    const r = await sendOne(deps(), fx.tenant, id); expect(r.kind).toBe('skipped'); expect(calls.length).toBe(0);
  });
  it('the same message handled twice sends once', async () => {
    const fx = await fixture(); calls.length = 0; uploadReply = () => ({ status: 200, body: { id: 'MID-TWICE' } }); const id = await fileMsg(fx);
    const [a, b] = await Promise.all([sendOne(deps(), fx.tenant, id), sendOne(deps(), fx.tenant, id)]);
    expect([a.kind, b.kind].filter((k) => k === 'sent').length).toBe(1); expect(sends().length).toBe(1);
  });
  it('two workspaces never share a file or a token', async () => {
    const a = await fixture(), b = await fixture(); calls.length = 0;
    const ia = await fileMsg(a), ib = await fileMsg(b);
    await sendOne(deps(), a.tenant, ia); await sendOne(deps(), b.tenant, ib);
    expect(uploads().map((u) => u.auth).sort()).toEqual([`Bearer ${a.token}`, `Bearer ${b.token}`].sort());
    expect(sends().map((u) => u.path).sort()).toEqual([`/v26.0/${a.pn}/messages`, `/v26.0/${b.pn}/messages`].sort());
  });
  it('a file row that belongs to another workspace is never sent, even if it points at this message', async () => {
    const a = await fixture(), b = await fixture(); calls.length = 0;
    const id = await fileMsg(a, { noFile: true });
    await db.execute(sql`insert into message_attachments (tenant_id, message_id, kind, mime, file_name, size_bytes, sha256, data) values (${b.tenant}, ${id}, 'image', 'image/png', 'stolen.png', ${PNG.length}, 'x', ${PNG})`);
    const r = await sendOne(deps(), a.tenant, id);
    expect(r.kind).toBe('skipped'); expect(calls.length).toBe(0);
  });
  it('a plain text reply still sends as text (nothing about files changed it)', async () => {
    const fx = await fixture(); calls.length = 0; const id = randomUUID();
    await db.execute(sql`insert into messages (id, tenant_id, conversation_id, direction, kind, body, status, phone_number_id) values (${id}, ${fx.tenant}, ${fx.conv}, 'out', 'text', 'Hello there', 'queued', ${fx.pn})`);
    expect((await sendOne(deps(), fx.tenant, id)).kind).toBe('sent'); expect(uploads().length).toBe(0); expect(sends()[0]!.json).toMatchObject({ type: 'text', text: { body: 'Hello there' } });
  });
});
