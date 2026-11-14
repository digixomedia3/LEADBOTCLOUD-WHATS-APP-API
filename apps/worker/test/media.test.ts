import { createServer, type Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '@lbc/db';
import { GraphClient, encryptSecret } from '@lbc/meta';
import { submitPendingTemplates } from '../src/templates';
import { mediaIdFor, sendOne, templateComponents } from '../src/send';

const src = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const pick = (re: RegExp) => re.exec(src)![1]!;
const w = createDb(process.env.DATABASE_URL_WORKER ?? pick(/process\.env\.DATABASE_URL_WORKER \?\?\s*'([^']+)'/), { max: 4 });
const admin = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? pick(/process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/), { max: 2 });
const db = w.db;
const A = admin.client.unsafe;
const KEY = randomBytes(32).toString('base64');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(300)]);

/* A small fake Graph that knows the media endpoints. */
interface Call { method: string; path: string; query: Record<string, string>; headers: Record<string, string | string[] | undefined>; body: Buffer }
const calls: Call[] = [];
let uploadFail: { status: number; body: unknown } | null = null;
let mediaFail: { status: number; body: unknown } | null = null;
let templateFail: { status: number; body: unknown } | null = null;
let server: Server, base = '';
beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const u = new URL(req.url!, 'http://x'); const path = u.pathname.replace(/^\/v26\.0\//, '');
      const body = Buffer.concat(chunks); calls.push({ method: req.method!, path, query: Object.fromEntries(u.searchParams), headers: req.headers, body });
      const send = (s: number, o: unknown) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (path.endsWith('/uploads')) return uploadFail ? send(uploadFail.status, uploadFail.body) : send(200, { id: 'upload:SESS-' + calls.length });
      if (path.startsWith('upload:')) return send(200, { h: '4::handle-' + calls.length });
      if (path.endsWith('/media')) return mediaFail ? send(mediaFail.status, mediaFail.body) : send(200, { id: String(1000000 + calls.length) });
      if (path.endsWith('/message_templates')) return templateFail ? send(templateFail.status, templateFail.body) : send(200, { id: String(9000 + calls.length), status: 'PENDING', category: 'MARKETING' });
      if (path.endsWith('/messages') || path.endsWith('/marketing_messages')) return send(200, { messaging_product: 'whatsapp', messages: [{ id: 'wamid.' + randomUUID() }] });
      send(404, { error: { message: 'no route', code: 100 } });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await A(`delete from audit_log where tenant_id in (select id from tenants where name like 'TM %')`);
  await A(`delete from tenants where name like 'TM %'`);
  await Promise.all([w.client.end(), admin.client.end()]);
});
beforeEach(() => { calls.length = 0; uploadFail = null; mediaFail = null; templateFail = null; });
const graph = () => new GraphClient({ graphVersion: 'v26.0', baseUrl: base, appId: 'APP1', appSecret: 'S', timeoutMs: 3000 });
const deps = () => ({ db, graph: graph(), tokenKey: KEY });
const q = async (text: string) => A(text);

async function tenant() {
  const id = randomUUID(), tag = id.slice(0, 8), pn = `tm-pn-${tag}`;
  await A(`insert into tenants (id, name) values ('${id}', 'TM ${tag}')`);
  await A(`insert into meta_accounts (tenant_id, messaging_account_id, business_token_enc, token_status, health_state) values ('${id}', 'tm-waba-${tag}', '${encryptSecret('TM-TOKEN', KEY)}', 'valid', 'ok')`);
  const acc = (await A(`select id from meta_accounts where tenant_id = '${id}'`))[0]!.id;
  await A(`insert into phone_numbers (tenant_id, meta_account_id, phone_number_id, display_phone_number) values ('${id}', '${acc}', '${pn}', '+91 98765 43210')`);
  return { id, pn, tag };
}
async function mediaTemplate(t: { id: string }, o: { kind?: string; status?: string; withAsset?: boolean; buttons?: object[] } = {}) {
  const name = 'pic_' + randomUUID().slice(0, 6);
  const tpl = (await A(`insert into templates (tenant_id, name, language, category, status, header_type, body, samples, buttons, submit_requested_at, category_current) values ('${t.id}', '${name}', 'en', 'marketing', '${o.status ?? 'pending'}', '${o.kind ?? 'image'}', 'Hi {{1}}, see our festival range this week.', '["Asha"]'::jsonb, '${JSON.stringify(o.buttons ?? [])}'::jsonb, now(), 'marketing') returning id`))[0]!.id as string;
  let asset: string | null = null;
  if (o.withAsset !== false) asset = (await A(`insert into template_assets (tenant_id, template_id, kind, mime, file_name, size_bytes, sha256, data) values ('${t.id}', '${tpl}', '${o.kind ?? 'image'}', 'image/png', 'offer.png', ${PNG.length}, 'x', decode('${PNG.toString('hex')}', 'hex')) returning id`))[0]!.id as string;
  return { id: tpl, name, asset };
}
const row = async (id: string) => (await q(`select * from templates where id = '${id}'`))[0]!;
const assetRow = async (id: string) => (await q(`select * from template_assets where id = '${id}'`))[0]!;

describe('submitting a template with a media header', () => {
  it('uploads the sample through the Resumable Upload API, then creates the template with that handle', async () => {
    const t = await tenant(); const x = await mediaTemplate(t);
    await submitPendingTemplates(deps());
    const up = calls.filter((c) => c.path.endsWith('/uploads') && c.path.startsWith('APP1')); expect(up).toHaveLength(1);
    expect(up[0]!.query).toMatchObject({ file_name: 'offer.png', file_length: String(PNG.length), file_type: 'image/png' });
    const put = calls.find((c) => c.path.startsWith('upload:'))!; expect(put.headers.authorization).toBe('OAuth TM-TOKEN'); expect(put.headers.file_offset).toBe('0'); expect(put.body.equals(PNG)).toBe(true);
    const create = calls.find((c) => c.path === `tm-waba-${t.tag}/message_templates`)!;
    const header = JSON.parse(create.body.toString()).components[0]; expect(header).toMatchObject({ type: 'HEADER', format: 'IMAGE' }); expect(header.example.header_handle[0]).toMatch(/^4::handle-/);
    expect((await row(x.id)).meta_template_id).toBeTruthy(); expect((await assetRow(x.asset!)).meta_handle).toBe(header.example.header_handle[0]);
  });
  it('a retry after Meta was briefly down does NOT upload the file again', async () => {
    const t = await tenant(); const x = await mediaTemplate(t);
    templateFail = { status: 500, body: { error: { message: 'down', code: 2, is_transient: true } } };
    await submitPendingTemplates(deps()); expect((await row(x.id)).status).toBe('pending');
    templateFail = null; calls.length = 0;
    await submitPendingTemplates(deps());
    expect(calls.filter((c) => c.path.endsWith('/uploads'))).toHaveLength(0); expect((await row(x.id)).meta_template_id).toBeTruthy();
  });
  it('Meta refusing the file hands the template back as a draft with the reason', async () => {
    const t = await tenant(); const x = await mediaTemplate(t);
    uploadFail = { status: 400, body: { error: { message: 'Invalid file', code: 100, error_data: { details: 'The image is too small' } } } };
    await submitPendingTemplates(deps());
    expect(await row(x.id)).toMatchObject({ status: 'draft' }); expect((await row(x.id)).submit_error).toMatch(/header file.*too small/i);
    expect(calls.some((c) => c.path === `tm-waba-${t.tag}/message_templates`)).toBe(false);
  });
  it('a temporary upload failure keeps it pending for the next pass', async () => {
    const t = await tenant(); const x = await mediaTemplate(t);
    uploadFail = { status: 500, body: { error: { message: 'x', code: 2, is_transient: true } } };
    await submitPendingTemplates(deps()); expect((await row(x.id)).status).toBe('pending');
  });
  it('a missing file goes back to draft instead of sending a header-less template', async () => {
    const t = await tenant(); const x = await mediaTemplate(t, { withAsset: false });
    await submitPendingTemplates(deps());
    expect(await row(x.id)).toMatchObject({ status: 'draft' }); expect((await row(x.id)).submit_error).toMatch(/header file is missing/i); expect(calls.some((c) => c.path === `tm-waba-${t.tag}/message_templates`)).toBe(false);
  });
  it('one workspace’s file is never used for another’s template', async () => {
    const a = await tenant(), b = await tenant(); const x = await mediaTemplate(a);
    await A(`update template_assets set tenant_id = '${b.id}' where id = '${x.asset}'`);
    await submitPendingTemplates(deps()); expect((await row(x.id)).status).toBe('draft');
    await A(`update template_assets set tenant_id = '${a.id}' where id = '${x.asset}'`);
  });
});

describe('sending with a media header', () => {
  it('uploads the file to the sending number once, caches the id, and reuses it', async () => {
    const t = await tenant(); const x = await mediaTemplate(t, { status: 'approved' });
    const id1 = await mediaIdFor(deps(), t.id, x.id, t.pn, 'TM-TOKEN'); const id2 = await mediaIdFor(deps(), t.id, x.id, t.pn, 'TM-TOKEN');
    expect(id1).toBe(id2); expect(calls.filter((c) => c.path === `${t.pn}/media`)).toHaveLength(1);
    const form = calls.find((c) => c.path === `${t.pn}/media`)!; expect(form.headers['content-type']).toMatch(/multipart\/form-data/); expect(form.body.includes(Buffer.from('messaging_product'))).toBe(true);
  });
  it('twenty parallel sends of one template to one number make ONE upload', async () => {
    const t = await tenant(); const x = await mediaTemplate(t, { status: 'approved' });
    const ids = await Promise.all(Array.from({ length: 20 }, () => mediaIdFor(deps(), t.id, x.id, t.pn, 'TM-TOKEN')));
    expect(new Set(ids).size).toBe(1); expect(calls.filter((c) => c.path === `${t.pn}/media`)).toHaveLength(1);
  });
  it('a failed upload is not remembered: the next send tries again', async () => {
    const t = await tenant(); const x = await mediaTemplate(t, { status: 'approved' });
    mediaFail = { status: 500, body: { error: { message: 'down', code: 2, is_transient: true } } };
    await expect(mediaIdFor(deps(), t.id, x.id, t.pn, 'TM-TOKEN')).rejects.toBeTruthy();
    mediaFail = null; expect(await mediaIdFor(deps(), t.id, x.id, t.pn, 'TM-TOKEN')).toMatch(/^\d+$/);
  });
  it('re-uploads after 25 days (Meta keeps media for 30), but not before', async () => {
    const t = await tenant(); const x = await mediaTemplate(t, { status: 'approved' });
    const first = await mediaIdFor(deps(), t.id, x.id, t.pn, 'TM-TOKEN');
    const age = (days: number) => A(`update template_assets set media_ids = jsonb_build_object('${t.pn}', jsonb_build_object('id', '${first}', 'at', '${new Date(Date.now() - days * 86_400_000).toISOString()}')) where id = '${x.asset}'`);
    await age(24); expect(await mediaIdFor(deps(), t.id, x.id, t.pn, 'TM-TOKEN')).toBe(first); expect(calls.filter((c) => c.path === `${t.pn}/media`)).toHaveLength(1);
    await age(26); const second = await mediaIdFor(deps(), t.id, x.id, t.pn, 'TM-TOKEN'); expect(second).not.toBe(first); expect(calls.filter((c) => c.path === `${t.pn}/media`)).toHaveLength(2);
  });
  it('the cached id is per sending number', async () => {
    const t = await tenant(); const x = await mediaTemplate(t, { status: 'approved' });
    await mediaIdFor(deps(), t.id, x.id, '1111111111', 'TM-TOKEN'); await mediaIdFor(deps(), t.id, x.id, '2222222222', 'TM-TOKEN');
    expect(calls.filter((c) => c.path.endsWith('/media'))).toHaveLength(2);
  });
  it('never sends another workspace’s file: an asset belonging to a different tenant is not found', async () => {
    const a = await tenant(), b = await tenant(); const x = await mediaTemplate(a, { status: 'approved' });
    await A(`update template_assets set tenant_id = '${b.id}' where id = '${x.asset}'`);
    await expect(mediaIdFor(deps(), a.id, x.id, a.pn, 'TM-TOKEN')).rejects.toThrow(/missing/); expect(calls.some((c) => c.path.endsWith('/media'))).toBe(false);
    await A(`update template_assets set tenant_id = '${a.id}' where id = '${x.asset}'`);
  });
  it('builds header, body variables and the copy-code button in order', () => {
    const c = templateComponents({ params: ['Asha'], code: 'DIWALI25' }, { header_type: 'image', buttons: [{ type: 'url' }, { type: 'copy_code' }] }, '1037543291543636')!;
    expect(c.map((x) => x.type)).toEqual(['header', 'body', 'button']);
    expect(c[2]).toMatchObject({ sub_type: 'copy_code', index: '1', parameters: [{ type: 'coupon_code', coupon_code: 'DIWALI25' }] });
    expect(templateComponents({}, { header_type: 'none', buttons: [] }, null)).toBeUndefined();
    expect(() => templateComponents({ params: ['a'] }, { header_type: 'none', buttons: [{ type: 'copy_code' }] }, null)).toThrow(/copy-code/);
  });
  it('a full send carries the media id in the header and the code on the button', async () => {
    const t = await tenant(); const x = await mediaTemplate(t, { status: 'approved', buttons: [{ type: 'copy_code', text: 'Copy code', value: 'EXAMPLE' }] });
    const phone = `+9199${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const c = (await A(`insert into contacts (tenant_id, phone_e164, name, consent_status) values ('${t.id}', '${phone}', 'Asha', 'allowed') returning id`))[0]!.id;
    const v = (await A(`insert into conversations (tenant_id, contact_id, phone_number_id, window_expires_at) values ('${t.id}', '${c}', '${t.pn}', now() + interval '1 hour') returning id`))[0]!.id;
    const m = (await A(`insert into messages (tenant_id, conversation_id, direction, kind, body, status, template_name, template_language, template_category, payload, phone_number_id) values ('${t.id}', '${v}', 'out', 'template', '${x.name}', 'queued', '${x.name}', 'en', 'marketing', '{"params":["Asha"],"code":"DIWALI25"}'::jsonb, '${t.pn}') returning id`))[0]!.id as string;
    const r = await sendOne(deps(), t.id, m); expect(r.kind).toBe('sent');
    const sent = calls.find((k) => k.path.endsWith('/marketing_messages') || k.path.endsWith('/messages'))!; const comps = JSON.parse(sent.body.toString()).template.components;
    expect(comps[0]).toMatchObject({ type: 'header', parameters: [{ type: 'image', image: { id: expect.stringMatching(/^\d+$/) } }] }); expect(comps[1].type).toBe('body');
    expect(comps[2]).toMatchObject({ type: 'button', sub_type: 'copy_code', index: '0', parameters: [{ type: 'coupon_code', coupon_code: 'DIWALI25' }] });
  });
  it('if the media upload fails temporarily the message waits and is retried, not failed', async () => {
    const t = await tenant(); const x = await mediaTemplate(t, { status: 'approved' });
    const phone = `+9199${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const c = (await A(`insert into contacts (tenant_id, phone_e164, name, consent_status) values ('${t.id}', '${phone}', 'Asha', 'allowed') returning id`))[0]!.id;
    const v = (await A(`insert into conversations (tenant_id, contact_id, phone_number_id, window_expires_at) values ('${t.id}', '${c}', '${t.pn}', now() + interval '1 hour') returning id`))[0]!.id;
    const m = (await A(`insert into messages (tenant_id, conversation_id, direction, kind, body, status, template_name, template_language, template_category, payload, phone_number_id) values ('${t.id}', '${v}', 'out', 'template', '${x.name}', 'queued', '${x.name}', 'en', 'marketing', '{"params":["Asha"]}'::jsonb, '${t.pn}') returning id`))[0]!.id as string;
    mediaFail = { status: 500, body: { error: { message: 'down', code: 2, is_transient: true } } };
    const r = await sendOne(deps(), t.id, m); expect(r.kind).toBe('retry');
    expect((await q(`select status, wamid from messages where id = '${m}'`))[0]).toMatchObject({ status: 'queued', wamid: null });
    mediaFail = null; expect((await sendOne(deps(), t.id, m)).kind).toBe('sent');
  });
});
