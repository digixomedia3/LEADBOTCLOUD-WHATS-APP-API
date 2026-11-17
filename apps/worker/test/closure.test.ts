import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '@lbc/db';
import { closeDueWorkspaces } from '../src/closure';

const w = createDb(process.env.DATABASE_URL_WORKER ?? 'postgres://worker:worker_dev_password@localhost:5433/leadbotcloud', { max: 3 });
const admin = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? 'postgres://postgres:postgres_dev_password@localhost:5433/leadbotcloud', { max: 2 });
const db = w.db; const rows = (r: unknown) => r as Record<string, any>[];
const made: string[] = [];
afterAll(async () => {
  await admin.client.unsafe(`delete from audit_log where tenant_id in (select id from tenants where name like 'CL %')`);
  await admin.client.unsafe(`delete from webhook_events where dedupe_key like 'cl:%' or dedupe_key like 'cl-orphan:%' or dedupe_key like 'cl-waba:%'`);
  await admin.client.unsafe(`delete from tenants where name like 'CL %'`);
  await admin.client.unsafe(`delete from "user" where id like 'cl-%'`);
  const left = Number((await admin.client.unsafe(`select count(*)::int n from tenants where name like 'CL %'`))[0]!.n);
  if (left) throw new Error(`cleanup left ${left} test workspaces behind`);
  await Promise.all([w.client.end(), admin.client.end()]);
});
const run = (o: { batch?: number; slices?: number; tenantIds?: string[]; now?: Date } = {}) => closeDueWorkspaces(db, { tenantIds: made, ...o });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const A = async (q: string) => rows(await admin.client.unsafe(q));
const count = async (table: string, t: string) => Number((await A(`select count(*)::int n from "${table}" where tenant_id = '${t}'`))[0]!.n);

/** A workspace with something in nearly every table, a closure already due. */
async function workspace(o: { due?: boolean; contacts?: number } = {}) {
  const t = randomUUID(), tag = t.slice(0, 8); made.push(t);
  const digits = '9166' + String(parseInt(tag, 16) % 100000000).padStart(8, '0');
  await admin.client.unsafe(`insert into tenants (id, name, legal_name, gstin) values ('${t}', 'CL ${tag}', 'Legal ${tag}', '27AAAAA0000A1Z5')`);
  const owner = `cl-owner-${tag}`, shared = `cl-shared-${tag}`;
  for (const u of [owner, shared]) await admin.client.unsafe(`insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('${u}', 'U', '${u}@example.test', true, now(), now())`);
  await admin.client.unsafe(`insert into tenant_members (tenant_id, user_id, role) values ('${t}', '${owner}', 'owner'), ('${t}', '${shared}', 'agent')`);
  // `shared` also belongs to ANOTHER workspace, so their sign-in must survive.
  const other = randomUUID(); made.push(other);
  await admin.client.unsafe(`insert into tenants (id, name) values ('${other}', 'CL other ${tag}')`);
  await admin.client.unsafe(`insert into tenant_members (tenant_id, user_id, role) values ('${other}', '${shared}', 'agent')`);
  const acc = rows(await db.execute(sql`insert into meta_accounts (tenant_id, messaging_account_id, business_token_enc, token_status, health_state) values (${t}, ${'cl-waba-' + tag}, 'SECRET-TOKEN', 'valid', 'ok') returning id`))[0]!;
  await db.execute(sql`insert into phone_numbers (tenant_id, meta_account_id, phone_number_id, display_phone_number) values (${t}, ${acc.id}, ${'cl-pn-' + tag}, '+91 9')`);
  const tpl = rows(await db.execute(sql`insert into templates (tenant_id, name, language, category, status, body, category_current) values (${t}, ${'cl_' + tag}, 'en', 'utility', 'approved', 'Hi', 'UTILITY') returning id`))[0]!;
  await db.execute(sql`insert into template_assets (tenant_id, template_id, kind, mime, file_name, size_bytes, sha256, data) values (${t}, ${tpl.id}, 'image', 'image/png', 'h.png', ${PNG.length}, 'x', ${PNG})`);
  const camp = rows(await db.execute(sql`insert into campaigns (tenant_id, name, status) values (${t}, 'camp', 'completed') returning id`))[0]!;
  const n = o.contacts ?? 3;
  for (let i = 0; i < n; i++) {
    const ph = '+' + digits.slice(0, -2) + String(10 + (i % 90));
    const c = rows(await db.execute(sql`insert into contacts (tenant_id, phone_e164, name, consent_status) values (${t}, ${i < 90 ? ph : '+9155' + String(parseInt(tag, 16) % 10000).padStart(4, '0') + String(100000 + i)}, 'Person', 'allowed') returning id`))[0]!;
    const v = rows(await db.execute(sql`insert into conversations (tenant_id, contact_id, status) values (${t}, ${c.id}, 'open') returning id`))[0]!;
    const m = rows(await db.execute(sql`insert into messages (tenant_id, conversation_id, direction, kind, body, status) values (${t}, ${v.id}, 'in', 'image', 'Photo', 'received') returning id`))[0]!;
    await db.execute(sql`insert into inbound_media (tenant_id, message_id, kind, meta_media_id, mime, state, data, size_bytes) values (${t}, ${m.id}, 'image', 'M', 'image/png', 'stored', ${PNG}, ${PNG.length})`);
    await db.execute(sql`insert into campaign_recipients (tenant_id, campaign_id, contact_id, phone_e164, state) values (${t}, ${camp.id}, ${c.id}, ${ph}, 'read')`);
    await db.execute(sql`insert into leads (tenant_id, contact_id, status) values (${t}, ${c.id}, 'new')`);
  }
  await db.execute(sql`insert into quick_replies (tenant_id, shortcut, body) values (${t}, 'hi', 'Hello')`);
  await admin.client.unsafe(`insert into webhook_events (signature_ok, phone_number_id, field, dedupe_key, payload) values (true, 'cl-pn-${tag}', 'messages', 'cl:${t}', '{"kind":"message","from":"${digits.slice(0, -2)}10"}'::jsonb)`);
  await admin.client.unsafe(`insert into connections (tenant_id, provider, external_id, label) values ('${t}', 'shopify', 'cl-shop-${tag}', 'My store')`);
  await admin.client.unsafe(`insert into api_keys (tenant_id, name, prefix, key_hash, scopes, created_by) values ('${t}', 'agent', 'lbc_${tag}', '${t.replace(/-/g, '').padEnd(64, 'a')}', '{contacts:read}', '${owner}')`);
  await admin.client.unsafe(`insert into invitations (tenant_id, email, role, token_hash, invited_by, expires_at) values ('${t}', 'invitee-${tag}@example.test', 'agent', 'cl-th-${tag}', '${owner}', now() + interval '3 days')`);
  if (o.due !== false) await admin.client.unsafe(`update tenants set closure_requested_at = now() - interval '31 days', closure_due_at = now() - interval '1 day', closure_requested_by = '${owner}' where id = '${t}'`);
  return { t, tag, digits, owner, shared, other, number: digits.slice(0, -2) + '10' };
}

describe('closing a workspace', () => {
  it('erases every table that holds the workspace data, keeps only the legally required records, and the number is nowhere in the database', async () => {
    const f = await workspace(); const r = await run();
    expect(r.closed).toBeGreaterThanOrEqual(1);
    const tables = (await A(`select distinct table_name from information_schema.columns where table_schema='public' and column_name='tenant_id' order by 1`)).map((x) => String(x.table_name));
    const KEPT = ['audit_log', 'invoices', 'subscriptions'];
    const leftover: string[] = [];
    for (const table of tables) { const n = await count(table, f.t); if (n > 0 && !KEPT.includes(table)) leftover.push(`${table} x${n}`); }
    expect(leftover).toEqual([]);
    const cols = await A(`select table_name, column_name from information_schema.columns where table_schema='public' and data_type in ('text','character varying','jsonb','json','ARRAY')`);
    const found: string[] = [];
    for (const c of cols) { const n = Number((await A(`select count(*)::int n from "${c.table_name}" where "${c.column_name}"::text like '%${f.number}%'`))[0]!.n); if (n) found.push(`${c.table_name}.${c.column_name}`); }
    expect(found).toEqual([]);
    const tenant = (await A(`select status, closed_at, name, legal_name, gstin from tenants where id = '${f.t}'`))[0]!;
    expect(tenant.status).toBe('offboarded'); expect(tenant.closed_at).not.toBeNull(); expect(tenant.name).toBe('CL ' + f.tag); expect(tenant.gstin).toBe('27AAAAA0000A1Z5');
  });
  it('an API key stops working the moment the workspace is shut, and is deleted when it closes (an AI agent cannot keep acting for a closed business)', async () => {
    const f = await workspace();
    const resolves = async () => Number((await A(`select count(*)::int n from api_keys k join tenants t on t.id = k.tenant_id where k.tenant_id = '${f.t}' and t.status not in ('suspended','offboarded')`))[0]!.n);
    expect(await resolves()).toBe(1);
    await run({ batch: 100, slices: 0 });   // shut first, even when the contacts cannot all be cleared in this pass
    expect((await A(`select status from tenants where id = '${f.t}'`))[0]!.status).toBe('offboarded'); expect(await resolves()).toBe(0);
    await run(); expect(await count('api_keys', f.t)).toBe(0); expect(await count('connections', f.t)).toBe(0); expect(await count('invitations', f.t)).toBe(0);
  });
  it('the connection token is gone, so the WhatsApp account cannot be used after closing', async () => {
    const f = await workspace(); await run();
    expect(await count('meta_accounts', f.t)).toBe(0); expect(await count('phone_numbers', f.t)).toBe(0);
  });
  it('stored webhook payloads that mention a customer are erased with the workspace, whether or not a contact still matches', async () => {
    const f = await workspace();
    await admin.client.unsafe(`insert into webhook_events (signature_ok, phone_number_id, field, dedupe_key, payload) values (true, 'cl-pn-${f.tag}', 'messages', 'cl-orphan:${f.t}', '{"kind":"message","from":"919000099999","text":"my address is 12 Rose Lane"}'::jsonb)`);
    await run();
    expect(Number((await A(`select count(*)::int n from webhook_events where phone_number_id = 'cl-pn-${f.tag}'`))[0]!.n)).toBe(0);
    expect(Number((await A(`select count(*)::int n from webhook_events where payload::text like '%Rose Lane%'`))[0]!.n)).toBe(0);
  });
  it('webhooks are found by the WhatsApp account id too, and another workspace webhooks are never removed', async () => {
    const f = await workspace(), keeper = await workspace({ due: false });
    const waba = (await A(`select messaging_account_id w from meta_accounts where tenant_id = '${f.t}'`))[0]!.w;
    await admin.client.unsafe(`insert into webhook_events (signature_ok, waba_id, field, dedupe_key, payload) values (true, '${waba}', 'message_template_status_update', 'cl-waba:${f.t}', '{"kind":"template","event":"APPROVED"}'::jsonb)`);
    const mine = async (id: string) => Number((await A(`select count(*)::int n from webhook_events w where w.phone_number_id in (select phone_number_id from phone_numbers where tenant_id = '${id}') or w.waba_id in (select messaging_account_id from meta_accounts where tenant_id = '${id}')`))[0]!.n);
    const keptBefore = await mine(keeper.t); expect(keptBefore).toBeGreaterThan(0); expect(await mine(f.t)).toBeGreaterThan(1);
    await run();
    expect(Number((await A(`select count(*)::int n from webhook_events where dedupe_key like 'cl-waba:${f.t}' or dedupe_key like 'cl:${f.t}'`))[0]!.n)).toBe(0);
    expect(await mine(keeper.t)).toBe(keptBefore);
  });
  it('the audit trail is kept, and the closing is recorded', async () => {
    const f = await workspace(); await run();
    const log = await A(`select action, after from audit_log where tenant_id = '${f.t}' and action = 'workspace.closed'`);
    expect(log.length).toBe(1); expect(Number(log[0]!.after.erasedRows)).toBeGreaterThan(0);
  });
  it('people: a member who belongs to no other workspace loses their sign-in; one who does keeps theirs', async () => {
    const f = await workspace(); await run();
    expect(await count('tenant_members', f.t)).toBe(0);
    expect((await A(`select id from "user" where id = '${f.owner}'`)).length).toBe(0);
    expect((await A(`select id from "user" where id = '${f.shared}'`)).length).toBe(1);
    expect((await A(`select user_id from tenant_members where tenant_id = '${f.other}'`)).length).toBe(1);
  });
  it('a platform staff member is never deleted, even if they only belonged to the closed workspace', async () => {
    const f = await workspace();
    await admin.client.unsafe(`insert into platform_admins (user_id) values ('${f.owner}') on conflict do nothing`);
    try { await run(); expect((await A(`select id from "user" where id = '${f.owner}'`)).length).toBe(1); }
    finally { await admin.client.unsafe(`delete from platform_admins where user_id = '${f.owner}'`); }
  });
  it('another workspace is completely untouched, including its own data', async () => {
    await workspace(); const keeper = await workspace({ due: false });
    const snap = async () => ({ c: await count('contacts', keeper.t), m: await count('messages', keeper.t), mt: await count('meta_accounts', keeper.t), w: await count('webhook_events', keeper.t), q: await count('quick_replies', keeper.t), k: await count('api_keys', keeper.t), cn: await count('connections', keeper.t), inv: await count('invitations', keeper.t) });
    const before = await snap(); await run();
    expect(await snap()).toEqual(before);
    expect((await A(`select status from tenants where id = '${keeper.t}'`))[0]!.status).not.toBe('offboarded');
    expect(Number((await A(`select count(*)::int n from webhook_events where payload::text like '%${keeper.number}%'`))[0]!.n)).toBeGreaterThan(0);
  });
});

describe('removing a workspace row outright (the cascade path)', () => {
  it('deleting the workspace itself works while it still holds contacts, recipients and webhooks (the erase trigger must not block it)', async () => {
    const f = await workspace({ due: false });
    expect(await count('contacts', f.t)).toBeGreaterThan(0);
    await admin.client.unsafe(`delete from audit_log where tenant_id = '${f.t}'`);
    await expect(admin.client.unsafe(`delete from tenants where id = '${f.t}'`)).resolves.toBeDefined();
    expect(Number((await A(`select count(*)::int n from tenants where id = '${f.t}'`))[0]!.n)).toBe(0);
    expect(Number((await A(`select count(*)::int n from campaign_recipients where tenant_id = '${f.t}'`))[0]!.n)).toBe(0);
  });
});

describe('when closing is allowed to happen', () => {
  it('not before the 30 days are up, and not when no closure was asked for', async () => {
    const early = await workspace({ due: false }); await admin.client.unsafe(`update tenants set closure_requested_at = now(), closure_due_at = now() + interval '29 days' where id = '${early.t}'`);
    const none = await workspace({ due: false });
    await run();
    expect(await count('contacts', early.t)).toBeGreaterThan(0); expect(await count('contacts', none.t)).toBeGreaterThan(0);
    expect((await A(`select status from tenants where id = '${early.t}'`))[0]!.status).not.toBe('offboarded');
  });
  it('the day after the window closes, it runs (time is judged by the clock given)', async () => {
    const f = await workspace({ due: false }); await admin.client.unsafe(`update tenants set closure_requested_at = now(), closure_due_at = now() + interval '30 days' where id = '${f.t}'`);
    await run(); expect(await count('contacts', f.t)).toBeGreaterThan(0);
    await run({ now: new Date(Date.now() + 31 * 86400_000) }); expect(await count('contacts', f.t)).toBe(0);
  });
  it('a workspace that never asked to close is never touched, however old it is (the request is what starts the clock)', async () => {
    const f = await workspace({ due: false });
    await admin.client.unsafe(`update tenants set created_at = now() - interval '5 years' where id = '${f.t}'`);
    const r = await run({ now: new Date(Date.now() + 3650 * 86400_000) });   // ten years from now
    expect(r.due).toBe(0); expect(await count('contacts', f.t)).toBeGreaterThan(0); expect(await count('api_keys', f.t)).toBe(1);
  });
  it('a cancelled request never runs', async () => {
    const f = await workspace(); await admin.client.unsafe(`update tenants set closure_requested_at = null, closure_due_at = null, closure_requested_by = null where id = '${f.t}'`);
    await run(); expect(await count('contacts', f.t)).toBeGreaterThan(0);
  });
  it('an already closed workspace is not processed again', async () => {
    const f = await workspace(); await run(); const second = await run();
    expect(second.closed).toBe(0); expect(second.due).toBe(0); expect(await count('contacts', f.t)).toBe(0);
  });
});

describe('big workspaces and crashes', () => {
  it('more contacts than one pass can do: it reports partial, keeps the workspace shut, and later passes finish it', async () => {
    const f = await workspace({ contacts: 250 });
    const first = await run({ batch: 100, slices: 1 }); expect(first.partial).toBe(1); expect(first.closed).toBe(0);   // one slice of 100 cannot clear 250 contacts
    expect((await A(`select status, closed_at from tenants where id = '${f.t}'`))[0]).toMatchObject({ status: 'offboarded', closed_at: null });
    const trail: string[] = [];
    let closed = 0; for (let i = 0; i < 10 && !closed; i++) { const r = await run({ batch: 100, slices: 1 }); closed = r.closed; trail.push(JSON.stringify(r) + ' left=' + (await count('contacts', f.t))); }
    expect(trail.length).toBeGreaterThanOrEqual(2);   // it took more than one later pass, not a lucky single one
    expect(closed).toBe(1); expect(await count('contacts', f.t)).toBe(0);
    expect((await A(`select closed_at from tenants where id = '${f.t}'`))[0]!.closed_at).not.toBeNull();
  }, 60_000);   // seeding 250 people with chats, files and recipients is slow on a small machine
  it('a pass that stopped half way (workspace shut, some contacts gone) is finished by the next one', async () => {
    const f = await workspace();
    await admin.client.unsafe(`update tenants set status = 'offboarded' where id = '${f.t}'`);
    await admin.client.unsafe(`delete from contacts where id in (select id from contacts where tenant_id = '${f.t}' limit 1)`);
    await run(); expect(await count('contacts', f.t)).toBe(0); expect((await A(`select closed_at from tenants where id = '${f.t}'`))[0]!.closed_at).not.toBeNull();
  });
  it('the batch size can never be zero or nonsense, and tenantIds that are not ids match nothing', async () => {
    await workspace();
    expect((await closeDueWorkspaces(db, { tenantIds: ['not-a-uuid', "x'; drop table tenants;--"] })).due).toBe(0);
    await run({ batch: 0 }); const g = await workspace(); await run({ batch: Number.NaN });
    expect(await count('contacts', g.t)).toBe(0);
  });
});
