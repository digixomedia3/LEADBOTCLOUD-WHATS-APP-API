import { createServer, type Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '@lbc/db';
import { GraphClient, encryptSecret } from '@lbc/meta';
import { deleteQueuedTemplates, submitPendingTemplates, syncTemplates, tenantsDueForSync } from '../src/templates';

const src = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const pick = (re: RegExp) => re.exec(src)![1]!;
const w = createDb(process.env.DATABASE_URL_WORKER ?? pick(/process\.env\.DATABASE_URL_WORKER \?\?\s*'([^']+)'/), { max: 4 });
const admin = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? pick(/process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/), { max: 2 });
const db = w.db;
const KEY = randomBytes(32).toString('base64');

// ---- in-memory Meta account: templates keyed by name|language ----
interface RT { id: string; name: string; language: string; status: string; category: string; components: unknown[]; quality_score?: { score: string } }
let store = new Map<string, RT>();
let createFailure: { status: number; body: unknown } | 'hangup' | null = null;
let deleted: string[] = [];
let listPages = 1;
const calls: { method: string; path: string; body?: any }[] = [];
let server: Server, base = '';
beforeAll(async () => {
  server = createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => {
      const u = new URL(req.url!, base); const path = u.pathname.replace(/^\/v26\.0\//, '');
      const body = b ? JSON.parse(b) : undefined; calls.push({ method: req.method!, path, body });
      const send = (s: number, o: unknown) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.method === 'POST' && path.endsWith('/message_templates')) {
        if (createFailure === 'hangup') { req.socket.destroy(); return; }
        if (createFailure) return send(createFailure.status, createFailure.body);
        const key = `${body.name}|${body.language}`;
        if (store.has(key)) return send(400, { error: { message: 'dup', code: 100, error_subcode: 2388024 } });
        const t: RT = { id: String(store.size + 9000), name: body.name, language: body.language, status: 'PENDING', category: body.category, components: body.components };
        store.set(key, t); return send(200, { id: t.id, status: t.status, category: t.category });
      }
      if (req.method === 'GET' && path.endsWith('/message_templates')) {
        const all = [...store.values()]; const after = u.searchParams.get('after');
        if (listPages > 1) { const i = after ? Number(after) : 0; const per = Math.ceil(all.length / listPages); const slice = all.slice(i, i + per); const next = i + per < all.length; return send(200, { data: slice, paging: next ? { cursors: { after: String(i + per) }, next: 'x' } : { cursors: {} } }); }
        return send(200, { data: all, paging: { cursors: {} } });
      }
      if (req.method === 'DELETE' && path.endsWith('/message_templates')) { const n = u.searchParams.get('name')!; deleted.push(n); for (const k of [...store.keys()]) if (k.startsWith(n + '|')) store.delete(k); return send(200, { success: true }); }
      send(404, { error: { message: 'no route', code: 100 } });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await admin.client.unsafe(`delete from audit_log where tenant_id in (select id from tenants where name like 'TS %')`);
  await admin.client.unsafe(`delete from tenants where name like 'TS %'`);
  await Promise.all([w.client.end(), admin.client.end()]);
});
beforeEach(() => { store = new Map(); createFailure = null; deleted = []; listPages = 1; calls.length = 0; });

const graph = () => new GraphClient({ graphVersion: 'v26.0', baseUrl: base, appId: 'A', appSecret: 'S', timeoutMs: 2000 });
const deps = () => ({ db, graph: graph(), tokenKey: KEY });
const q = async <T = any>(s: ReturnType<typeof sql>) => (await db.execute(s)) as unknown as T[];

async function tenant(o: { tokenStatus?: string } = {}) {
  const id = randomUUID(), tag = id.slice(0, 8);
  await admin.client.unsafe(`insert into tenants (id, name) values ('${id}', 'TS ${tag}')`);
  await db.execute(sql`insert into meta_accounts (tenant_id, messaging_account_id, business_token_enc, token_status, health_state) values (${id}, ${'ts-waba-' + tag}, ${encryptSecret('TS-TOKEN', KEY)}, ${o.tokenStatus ?? 'valid'}, 'ok')`);
  return id;
}
async function tpl(tenantId: string, o: Partial<{ name: string; status: string; body: string; samples: string[]; category: string; meta: string | null; attempts: number }> = {}) {
  const name = o.name ?? 'offer_' + randomUUID().slice(0, 6);
  const r = await q<{ id: string }>(sql`insert into templates (tenant_id, name, language, category, status, body, samples, meta_template_id, submit_attempts, submit_requested_at) values (${tenantId}, ${name}, 'en', ${o.category ?? 'marketing'}, ${o.status ?? 'pending'}, ${o.body ?? 'Hi {{1}}, offer {{2}} today'}, ${JSON.stringify(o.samples ?? ['Asha', '20% off'])}::jsonb, ${o.meta ?? null}, ${o.attempts ?? 0}, now()) returning id`);
  return { id: r[0]!.id, name };
}
const row = async (id: string) => (await q(sql`select * from templates where id = ${id}`))[0]!;

describe('submitPendingTemplates', () => {
  it('creates the format at Meta with the right payload, then stores the id and returned category', async () => {
    const t = await tenant(); const x = await tpl(t);
    const r = await submitPendingTemplates(deps());
    expect(r.sent).toBeGreaterThanOrEqual(1);
    const c = calls.find((k) => k.method === 'POST')!;
    expect(c.path).toMatch(/^ts-waba-.*\/message_templates$/);
    expect(c.body).toMatchObject({ name: x.name, language: 'en', category: 'MARKETING', parameter_format: 'POSITIONAL' });
    expect(c.body.components[0]).toEqual({ type: 'BODY', text: 'Hi {{1}}, offer {{2}} today', example: { body_text: [['Asha', '20% off']] } });
    const t1 = await row(x.id);
    expect(t1).toMatchObject({ status: 'pending', category_current: 'marketing', submit_error: null }); expect(t1.meta_template_id).toBeTruthy();
  });
  it('only ever submits once: a second pass does nothing', async () => {
    const t = await tenant(); await tpl(t);
    await submitPendingTemplates(deps()); const before = calls.filter((k) => k.method === 'POST').length;
    await submitPendingTemplates(deps());
    expect(calls.filter((k) => k.method === 'POST').length).toBe(before);
  });
  it('a tenant with an expired connection waits: stays pending, no Graph call', async () => {
    const t = await tenant({ tokenStatus: 'invalid' }); const x = await tpl(t);
    const r = await submitPendingTemplates(deps());
    expect(r.waiting).toBeGreaterThanOrEqual(1); expect((await row(x.id)).status).toBe('pending');
    expect(calls.filter((k) => k.path.startsWith('ts-waba-' + t.slice(0, 8)))).toHaveLength(0);
  });
  it('a shape it cannot build goes back to draft with a plain reason (no Graph call)', async () => {
    const t = await tenant(); const x = await tpl(t, { category: 'authentication' });
    await submitPendingTemplates(deps());
    expect(await row(x.id)).toMatchObject({ status: 'draft' }); expect((await row(x.id)).submit_error).toMatch(/not supported/);
  });
  it('Meta refusing the name (2388024) retries, then hands it back with a rename message', async () => {
    const t = await tenant(); const x = await tpl(t, { name: 'dupe_one' });
    store.set('dupe_one|en', { id: '1', name: 'dupe_one', language: 'en', status: 'APPROVED', category: 'MARKETING', components: [] });
    await db.execute(sql`update templates set submit_attempts = 3 where id = ${x.id}`);
    await submitPendingTemplates(deps());
    const t1 = await row(x.id);
    expect(t1.status).toBe('draft'); expect(t1.submit_error).toMatch(/already exists/i);
  });
  it('a Meta outage keeps it pending for the next pass; a network drop does too and nothing is lost', async () => {
    const t = await tenant(); const x = await tpl(t);
    createFailure = { status: 500, body: { error: { message: 'x', code: 2, is_transient: true } } };
    await submitPendingTemplates(deps()); expect((await row(x.id)).status).toBe('pending');
    createFailure = 'hangup';
    await submitPendingTemplates(deps()); expect((await row(x.id)).status).toBe('pending');
    createFailure = null;
    await submitPendingTemplates(deps()); expect((await row(x.id)).meta_template_id).toBeTruthy();
  });
  it('token error 190 marks the connection invalid and returns the format as draft with a reason', async () => {
    const t = await tenant(); const x = await tpl(t);
    createFailure = { status: 401, body: { error: { message: 'x', code: 190 } } };
    await submitPendingTemplates(deps());
    expect((await q(sql`select token_status from meta_accounts where tenant_id = ${t}`))[0].token_status).toBe('invalid');
    expect((await row(x.id)).status).toBe('draft');
  });
  it('never touches another tenant\'s formats with this tenant\'s token', async () => {
    const a = await tenant(), b = await tenant(); await tpl(a); await tpl(b);
    await submitPendingTemplates(deps());
    const byWaba = new Map<string, number>(); for (const k of calls.filter((c) => c.method === 'POST')) byWaba.set(k.path.split('/')[0]!, (byWaba.get(k.path.split('/')[0]!) ?? 0) + 1);
    expect(byWaba.get('ts-waba-' + a.slice(0, 8))).toBe(1); expect(byWaba.get('ts-waba-' + b.slice(0, 8))).toBe(1);
  });
});

describe('syncTemplates', () => {
  it('adopts the status Meta reports (approved), with category and quality', async () => {
    const t = await tenant(); const x = await tpl(t, { name: 'sync_ok' });
    store.set('sync_ok|en', { id: '501', name: 'sync_ok', language: 'en', status: 'APPROVED', category: 'UTILITY', components: [], quality_score: { score: 'GREEN' } });
    const r = await syncTemplates(deps(), t);
    expect(r).toMatchObject({ seen: 1, adopted: 1 });
    expect(await row(x.id)).toMatchObject({ status: 'approved', category_current: 'utility', quality: 'green', meta_template_id: '501' });
  });
  it('a format Meta rejected becomes rejected', async () => {
    const t = await tenant(); const x = await tpl(t, { name: 'sync_rej' });
    store.set('sync_rej|en', { id: '502', name: 'sync_rej', language: 'en', status: 'REJECTED', category: 'MARKETING', components: [] });
    await syncTemplates(deps(), t); expect((await row(x.id)).status).toBe('rejected');
  });
  it('does not overwrite a draft the owner is editing or a format being deleted', async () => {
    const t = await tenant(); const d = await tpl(t, { name: 'edit_me', status: 'draft' }), g = await tpl(t, { name: 'going', status: 'deleting' });
    store.set('edit_me|en', { id: '503', name: 'edit_me', language: 'en', status: 'APPROVED', category: 'MARKETING', components: [] });
    store.set('going|en', { id: '504', name: 'going', language: 'en', status: 'APPROVED', category: 'MARKETING', components: [] });
    await syncTemplates(deps(), t);
    expect((await row(d.id)).status).toBe('draft'); expect((await row(g.id)).status).toBe('deleting');
  });
  it('imports a text format made in WhatsApp Manager, and counts (does not import) ones it cannot represent', async () => {
    const t = await tenant();
    store.set('from_manager|en_US', { id: '510', name: 'from_manager', language: 'en_US', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Your order {{1}} shipped', example: { body_text: [['#123']] } }, { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Track' }] }] });
    store.set('has_image|en', { id: '511', name: 'has_image', language: 'en', status: 'APPROVED', category: 'MARKETING', components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'hi' }] });
    const r = await syncTemplates(deps(), t);
    expect(r).toMatchObject({ seen: 2, imported: 1, skipped: 1 });
    expect((await q(sql`select name, status, category, body from templates where tenant_id = ${t}`))).toEqual([{ name: 'from_manager', status: 'approved', category: 'utility', body: 'Your order {{1}} shipped' }]);
  });
  it('a status it does not know leaves the row untouched', async () => {
    const t = await tenant(); const x = await tpl(t, { name: 'weird', status: 'approved', meta: '9' });
    store.set('weird|en', { id: '9', name: 'weird', language: 'en', status: 'SOMETHING_NEW', category: 'MARKETING', components: [] });
    const r = await syncTemplates(deps(), t);
    expect(r!.skipped).toBe(1); expect((await row(x.id)).status).toBe('approved');
  });
  it('reads every page of a long list', async () => {
    const t = await tenant(); listPages = 3;
    for (let i = 0; i < 9; i++) store.set(`p${i}|en`, { id: String(600 + i), name: `p${i}`, language: 'en', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: `Message ${i}` }] });
    const r = await syncTemplates(deps(), t);
    expect(r).toMatchObject({ seen: 9, imported: 9 });
  });
  it('a pending format Meta never lists after several tries is handed back with a reason', async () => {
    const t = await tenant(); const x = await tpl(t, { name: 'ghost', attempts: 3 });
    await syncTemplates(deps(), t);
    expect(await row(x.id)).toMatchObject({ status: 'draft' }); expect((await row(x.id)).submit_error).toMatch(/did not accept/);
  });
  it('returns null for a disconnected tenant and sets the sync time for a connected one', async () => {
    const off = await tenant({ tokenStatus: 'revoked' }), on = await tenant();
    expect(await syncTemplates(deps(), off)).toBeNull();
    await syncTemplates(deps(), on);
    expect((await q(sql`select templates_synced_at from meta_accounts where tenant_id = ${on}`))[0].templates_synced_at).not.toBeNull();
    expect(await tenantsDueForSync(db, 360)).not.toContain(on);
  });
});

describe('deleteQueuedTemplates', () => {
  it('deletes at Meta first, then removes the row', async () => {
    const t = await tenant(); const x = await tpl(t, { name: 'bye', status: 'deleting', meta: '700' });
    store.set('bye|en', { id: '700', name: 'bye', language: 'en', status: 'APPROVED', category: 'MARKETING', components: [] });
    await deleteQueuedTemplates(deps());
    expect(deleted).toContain('bye'); expect(await q(sql`select 1 from templates where id = ${x.id}`)).toHaveLength(0);
  });
  it('a format that never reached Meta is just removed, with no Graph call', async () => {
    const t = await tenant(); const x = await tpl(t, { status: 'deleting', meta: null });
    await deleteQueuedTemplates(deps());
    expect(await q(sql`select 1 from templates where id = ${x.id}`)).toHaveLength(0); expect(deleted).toHaveLength(0);
  });
  it('while disconnected the row stays, so nothing is lost', async () => {
    const t = await tenant({ tokenStatus: 'invalid' }); const x = await tpl(t, { status: 'deleting', meta: '701' });
    await deleteQueuedTemplates(deps());
    expect(await q(sql`select 1 from templates where id = ${x.id}`)).toHaveLength(1);
  });
});
