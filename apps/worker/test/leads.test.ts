import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '@lbc/db';
import { hashSecret, importLeads, ingestLead, submitForm } from '../src/leads';
import { handleInbound } from '../src/handlers';

const src = (await import('node:fs')).readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const pick = (re: RegExp) => re.exec(src)![1]!;
const w = createDb(process.env.DATABASE_URL_WORKER ?? pick(/process\.env\.DATABASE_URL_WORKER \?\?\s*'([^']+)'/), { max: 6 });
const admin = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? pick(/process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/), { max: 2 });
const db = w.db;
const tag = randomUUID().slice(0, 8);
const q = async <T = any>(s: ReturnType<typeof sql>) => (await db.execute(s)) as unknown as T[];
const A = admin.client.unsafe;

afterAll(async () => {
  await A(`delete from audit_log where tenant_id in (select id from tenants where name like 'LD ${tag}%')`);
  await A(`delete from tenants where name like 'LD ${tag}%'`);
  await A(`delete from "user" where id like 'ld-${tag}-%'`);
  await Promise.all([w.client.end(), admin.client.end()]);
});

let n = 0;
async function setup(o: { mode?: string; secret?: string | null; enabled?: boolean; tags?: string[]; assign?: number; plan?: string; fieldMap?: object; group?: boolean } = {}) {
  const t = randomUUID(), i = ++n, pid = `pub${tag}${i}`;
  await A(`insert into tenants (id, name, plan_id) values ('${t}', 'LD ${tag} ${i}', '${o.plan ?? 'growth'}')`);
  const users: string[] = [];
  for (let k = 0; k < (o.assign ?? 0); k++) {
    const u = `ld-${tag}-${i}-${k}`; users.push(u);
    await A(`insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('${u}', '${u}', '${u}@example.com', true, now(), now())`);
    await A(`insert into tenant_members (tenant_id, user_id, role) values ('${t}', '${u}', '${k === 0 ? 'owner' : 'agent'}')`);
  }
  let gid: string | null = null;
  if (o.group) gid = (await A(`insert into contact_groups (tenant_id, name) values ('${t}', 'Web leads') returning id`))[0]!.id;
  const secret = o.secret === undefined ? 'sek-' + pid : o.secret;
  const mode = o.mode ?? 'none';
  const att = mode === 'attested' ? `, attested_by, attested_at` : '', attv = mode === 'attested' ? `, 'owner', now()` : '';
  await db.execute(sql`select 1`);
  const s = (await A(`insert into lead_sources (tenant_id, kind, name, public_id, secret_hash, consent_mode, default_tags, assign_user_ids, field_map, default_group_id, enabled${att})
    values ('${t}', 'webhook', 'Src ${i}', '${pid}', ${secret ? `'${hashSecret(secret)}'` : 'null'}, '${mode}', '{${(o.tags ?? []).join(',')}}', '{${users.join(',')}}', '${JSON.stringify(o.fieldMap ?? {})}', ${gid ? `'${gid}'` : 'null'}, ${o.enabled === false ? 'false' : 'true'}${attv}) returning id`))[0]!;
  return { t, pid, secret, users, sid: s.id as string, gid };
}
const post = (pid: string, secret: string | undefined | null, body: unknown, ct = 'application/json') =>
  ingestLead(db, pid, secret ?? undefined, Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)), ct);
const contactOf = async (t: string, phone: string) => (await q<any>(sql`select * from contacts where tenant_id = ${t} and phone_e164 = ${phone}`))[0];
const count = async (table: string, t: string) => Number((await q(sql`select count(*)::int as n from ${sql.raw(table)} where tenant_id = ${t}`))[0].n);

describe('source checks', () => {
  it('unknown source is 404, wrong or missing key 401, disabled 403', async () => {
    const s = await setup();
    expect((await post('nope' + tag, 'x', { phone: '9876543210' })).status).toBe(404);
    expect((await post(s.pid, 'wrong', { phone: '9876543210' })).status).toBe(401);
    expect((await post(s.pid, undefined, { phone: '9876543210' })).status).toBe(401);
    const off = await setup({ enabled: false });
    expect((await post(off.pid, off.secret, { phone: '9876543210' })).status).toBe(403);
    expect(await count('leads', s.t)).toBe(0); expect(await count('contacts', s.t)).toBe(0);
  });
  it('a source without a secret accepts posts (for tools that cannot send one)', async () => {
    const s = await setup({ secret: null });
    expect((await post(s.pid, undefined, { phone: '9876543210' })).status).toBe(200);
  });
});

describe('bad input is refused and recorded', () => {
  it('unreadable body -> 400, no phone / invalid phone -> 422, with a reject row each', async () => {
    const s = await setup();
    expect((await post(s.pid, s.secret, 'hello', 'text/plain')).status).toBe(400);
    expect((await post(s.pid, s.secret, { name: 'No phone' })).status).toBe(422);
    expect((await post(s.pid, s.secret, { phone: '12345' })).status).toBe(422);
    const r = await q<any>(sql`select reason from lead_rejects where tenant_id = ${s.t} order by id`);
    expect(r.map((x) => x.reason)).toEqual(['unreadable', 'invalid_phone', 'invalid_phone']);
    expect(await count('leads', s.t)).toBe(0);
  });
  it('an oversized body is refused', async () => {
    const s = await setup();
    expect((await post(s.pid, s.secret, JSON.stringify({ phone: '9876543210', blob: 'x'.repeat(70_000) }))).status).toBe(413);
  });
});

describe('creating the lead and contact', () => {
  it('creates a contact (normalised phone) and a new lead with UTM, tags and group', async () => {
    const s = await setup({ tags: ['web'], group: true });
    const r = await post(s.pid, s.secret, { name: 'Asha Verma', mobile: '98765 43210', email: 'Asha@Example.com', city: 'Lucknow', utm_source: 'google', utm_campaign: 'diwali', page_url: 'https://x.in/lp', tags: 'vip' });
    expect(r).toMatchObject({ status: 200, created: true });
    const c = await contactOf(s.t, '+919876543210');
    expect(c).toMatchObject({ name: 'Asha Verma', email: 'asha@example.com' }); expect([...c.tags].sort()).toEqual(['vip', 'web']);
    const l = (await q<any>(sql`select * from leads where tenant_id = ${s.t}`))[0];
    expect(l).toMatchObject({ status: 'new', source_url: 'https://x.in/lp', submissions: 1 });
    expect(l.utm).toEqual({ utm_source: 'google', utm_campaign: 'diwali' }); expect(l.fields).toEqual({ city: 'Lucknow' });
    expect(await count('contact_group_members', s.t)).toBe(1);
    expect((await q<any>(sql`select lead_count from lead_sources where id = ${s.sid}`))[0].lead_count).toBe(1);
  });
  it('reads urlencoded forms and Facebook-style field_data', async () => {
    const s = await setup();
    expect((await post(s.pid, s.secret, 'name=Ravi&phone=9876500001', 'application/x-www-form-urlencoded')).status).toBe(200);
    expect((await post(s.pid, s.secret, { field_data: [{ name: 'full_name', values: ['Meena'] }, { name: 'phone_number', values: ['+919876500002'] }] })).status).toBe(200);
    expect((await contactOf(s.t, '+919876500002')).name).toBe('Meena');
  });
  it('uses the source field map for platform-specific names', async () => {
    const s = await setup({ fieldMap: { phone: 'Buyer Contact', name: 'Buyer' } });
    expect((await post(s.pid, s.secret, { 'Buyer Contact': '9876500003', Buyer: 'Kiran' })).status).toBe(200);
    expect((await contactOf(s.t, '+919876500003')).name).toBe('Kiran');
  });
});

describe('consent is never assumed', () => {
  it('mode none: contact is unknown (reply-only), no consent event', async () => {
    const s = await setup({ mode: 'none' });
    const r = await post(s.pid, s.secret, { phone: '9876500010', whatsapp_consent: 'yes' });
    expect(r).toMatchObject({ status: 200, consent: 'unknown' });
    expect((await contactOf(s.t, '+919876500010')).consent_status).toBe('unknown'); expect(await count('contact_consent_events', s.t)).toBe(0);
  });
  it('mode field: allowed only when ticked, with a consent event naming the source', async () => {
    const s = await setup({ mode: 'field' });
    expect((await post(s.pid, s.secret, { phone: '9876500011' })) ).toMatchObject({ consent: 'unknown' });
    expect((await post(s.pid, s.secret, { phone: '9876500012', whatsapp_consent: 'on' }))).toMatchObject({ consent: 'allowed' });
    const c = await contactOf(s.t, '+919876500012'); expect(c).toMatchObject({ consent_status: 'allowed', consent_source: 'Website form' });
    const e = await q<any>(sql`select action, note from contact_consent_events where contact_id = ${c.id}`);
    expect(e).toHaveLength(1); expect(e[0].action).toBe('opt_in'); expect(e[0].note).toContain('consent_field');
  });
  it('mode attested: every submission grants consent', async () => {
    const s = await setup({ mode: 'attested' });
    expect(await post(s.pid, s.secret, { phone: '9876500013' })).toMatchObject({ consent: 'allowed' });
  });
  it('a later consented submission upgrades unknown to allowed, once', async () => {
    const s = await setup({ mode: 'field' });
    await post(s.pid, s.secret, { phone: '9876500014' });
    await post(s.pid, s.secret, { phone: '9876500014', whatsapp_consent: 'yes' });
    await post(s.pid, s.secret, { phone: '9876500014', whatsapp_consent: 'yes' });
    expect((await contactOf(s.t, '+919876500014')).consent_status).toBe('allowed'); expect(await count('contact_consent_events', s.t)).toBe(1);
  });
  it('NEVER overrides a STOP: a stopped contact stays stopped even when the form is ticked', async () => {
    const s = await setup({ mode: 'attested' });
    await A(`insert into contacts (tenant_id, phone_e164, consent_status, opt_out_at, opt_out_source) values ('${s.t}', '+919876500015', 'stopped', now(), 'whatsapp_keyword')`);
    const r = await post(s.pid, s.secret, { phone: '9876500015', whatsapp_consent: 'yes' });
    expect(r).toMatchObject({ status: 200, consent: 'stopped' });
    expect((await contactOf(s.t, '+919876500015')).consent_status).toBe('stopped'); expect(await count('contact_consent_events', s.t)).toBe(0);
  });
});

describe('duplicates', () => {
  it('the same person posting again adds to the open lead instead of creating another', async () => {
    const s = await setup();
    const a = await post(s.pid, s.secret, { phone: '9876500020', city: 'Agra' });
    const b = await post(s.pid, s.secret, { phone: '+91 98765-00020', budget: '50k' });
    expect(a).toMatchObject({ created: true }); expect(b).toMatchObject({ created: false });
    expect((a as any).leadId).toBe((b as any).leadId);
    const l = (await q<any>(sql`select submissions, fields from leads where tenant_id = ${s.t}`));
    expect(l).toHaveLength(1); expect(l[0].submissions).toBe(2); expect(l[0].fields).toEqual({ city: 'Agra', budget: '50k' });
    expect(await count('contacts', s.t)).toBe(1);
  });
  it('a closed lead lets the same person start a fresh one', async () => {
    const s = await setup();
    const a = await post(s.pid, s.secret, { phone: '9876500021' });
    await A(`update leads set status = 'won' where id = '${(a as any).leadId}'`);
    const b = await post(s.pid, s.secret, { phone: '9876500021' });
    expect(b).toMatchObject({ created: true }); expect(await count('leads', s.t)).toBe(2);
  });
  it('an existing contact keeps its name and gains missing details', async () => {
    const s = await setup();
    await A(`insert into contacts (tenant_id, phone_e164, name, consent_status) values ('${s.t}', '+919876500022', 'Original Name', 'allowed')`);
    await post(s.pid, s.secret, { phone: '9876500022', name: 'Someone Else', email: 'x@y.in' });
    expect(await contactOf(s.t, '+919876500022')).toMatchObject({ name: 'Original Name', email: 'x@y.in', consent_status: 'allowed' });
  });
  it('a burst of identical concurrent posts makes exactly one lead and one contact', async () => {
    const s = await setup();
    const rs = await Promise.all(Array.from({ length: 12 }, () => post(s.pid, s.secret, { phone: '9876500023' })));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(await count('leads', s.t)).toBe(1); expect(await count('contacts', s.t)).toBe(1);
    expect((await q<any>(sql`select submissions from leads where tenant_id = ${s.t}`))[0].submissions).toBe(12);
    expect(rs.filter((r) => (r as any).created).length).toBe(1);
  });
});

describe('assignment and limits', () => {
  it('round robin cycles through assignees who are still members', async () => {
    const s = await setup({ assign: 3 });
    for (let k = 0; k < 6; k++) await post(s.pid, s.secret, { phone: `98765000${30 + k}` });
    const owners = (await q<any>(sql`select owner_user_id from leads where tenant_id = ${s.t} order by created_at, id`)).map((r) => r.owner_user_id as string);
    const counts = owners.reduce<Record<string, number>>((m, o) => ((m[o] = (m[o] ?? 0) + 1), m), {});
    expect(Object.values(counts)).toEqual([2, 2, 2]); expect(new Set(owners)).toEqual(new Set(s.users));
  });
  it('skips an assignee who has left the workspace', async () => {
    const s = await setup({ assign: 2 });
    await A(`delete from tenant_members where tenant_id = '${s.t}' and user_id = '${s.users[1]}'`);
    for (let k = 0; k < 3; k++) await post(s.pid, s.secret, { phone: `98765000${40 + k}` });
    const owners = (await q<any>(sql`select distinct owner_user_id from leads where tenant_id = ${s.t}`)).map((r) => r.owner_user_id);
    expect(owners).toEqual([s.users[0]]);
  });
  it('with no assignees, leads are unassigned', async () => {
    const s = await setup(); await post(s.pid, s.secret, { phone: '9876500050' });
    expect((await q<any>(sql`select owner_user_id from leads where tenant_id = ${s.t}`))[0].owner_user_id).toBeNull();
  });
  it('refuses a NEW contact when the plan is full (402) but still accepts an existing one', async () => {
    const s = await setup({ plan: 'free' });
    await A(`insert into contacts (tenant_id, phone_e164, consent_status) select '${s.t}', '+9190000' || lpad(g::text, 5, '0'), 'unknown' from generate_series(1, 500) g`);
    expect((await post(s.pid, s.secret, { phone: '9876500060' })).status).toBe(402);
    expect((await q<any>(sql`select reason from lead_rejects where tenant_id = ${s.t}`))[0].reason).toBe('plan_full');
    expect((await post(s.pid, s.secret, { phone: '9000000001' })).status).toBe(200);
  });
  it('events record creation and assignment', async () => {
    const s = await setup({ assign: 1 }); const r = await post(s.pid, s.secret, { phone: '9876500070' });
    const e = await q<any>(sql`select kind from lead_events where lead_id = ${(r as any).leadId} order by id`);
    expect(e.map((x) => x.kind)).toEqual(['created', 'assigned']);
  });
});

describe('tenant isolation', () => {
  it('a lead for one workspace never lands in another with the same phone number', async () => {
    const a = await setup(), b = await setup();
    await post(a.pid, a.secret, { phone: '9876500080' }); await post(b.pid, b.secret, { phone: '9876500080' });
    expect(await count('contacts', a.t)).toBe(1); expect(await count('contacts', b.t)).toBe(1);
    expect((await contactOf(a.t, '+919876500080')).id).not.toBe((await contactOf(b.t, '+919876500080')).id);
  });
  it('a secret from one source does not open another', async () => {
    const a = await setup(), b = await setup();
    expect((await post(b.pid, a.secret, { phone: '9876500081' })).status).toBe(401);
  });
});

/* ---------------------------------------------------------------- P2: platform formats, forms, ad clicks */

const indiamart = (id: string, over: Record<string, unknown> = {}) => ({ CODE: 200, STATUS: 'SUCCESS', RESPONSE: { UNIQUE_QUERY_ID: id, QUERY_TYPE: 'W', QUERY_TIME: '2026-11-13 11:17:14', SENDER_NAME: 'Prabhat', SENDER_MOBILE: '+91-9876510001', SENDER_EMAIL: 'p@example.com', SENDER_CITY: 'Noida', SENDER_COUNTRY_ISO: 'IN', QUERY_PRODUCT_NAME: 'Water Bottle', QUERY_MESSAGE: 'Need 1000 pcs', ...over } });

describe('platform retries are harmless (external ids)', () => {
  it('an IndiaMART push creates a lead with the product and message', async () => {
    const s = await setup({ mode: 'none' });
    const r = await post(s.pid, s.secret, indiamart('Q1'));
    expect(r).toMatchObject({ status: 200, created: true });
    const l = (await q<any>(sql`select fields from leads where tenant_id = ${s.t}`))[0];
    expect(l.fields).toMatchObject({ query_product_name: 'Water Bottle', query_message: 'Need 1000 pcs', sender_city: 'Noida' });
    expect((await contactOf(s.t, '+919876510001')).name).toBe('Prabhat');
  });
  it('the same query id sent again changes nothing, even concurrently', async () => {
    const s = await setup();
    const rs = await Promise.all(Array.from({ length: 8 }, () => post(s.pid, s.secret, indiamart('Q2', { SENDER_MOBILE: '9876510002' }))));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(await count('leads', s.t)).toBe(1); expect(await count('lead_external_ids', s.t)).toBe(1);
    expect((await q<any>(sql`select submissions from leads where tenant_id = ${s.t}`))[0].submissions).toBe(1);
    expect(rs.filter((r) => (r as any).created).length).toBe(1);
    expect(rs.filter((r) => (r as any).duplicate).length).toBe(7);
    expect(new Set(rs.map((r) => (r as any).leadId)).size).toBe(1);
  });
  it('a different query id from the same buyer adds to their open lead', async () => {
    const s = await setup();
    await post(s.pid, s.secret, indiamart('Q3', { SENDER_MOBILE: '9876510003' }));
    const b = await post(s.pid, s.secret, indiamart('Q4', { SENDER_MOBILE: '9876510003', QUERY_PRODUCT_NAME: 'Bottle Caps' }));
    expect(b).toMatchObject({ created: false });
    const l = (await q<any>(sql`select submissions, fields from leads where tenant_id = ${s.t}`));
    expect(l).toHaveLength(1); expect(l[0].submissions).toBe(2); expect(l[0].fields.query_product_name).toBe('Bottle Caps');
  });
  it('the same id on two different sources is two different leads', async () => {
    const a = await setup(), b = await setup();
    await post(a.pid, a.secret, indiamart('SAME', { SENDER_MOBILE: '9876510004' })); await post(b.pid, b.secret, indiamart('SAME', { SENDER_MOBILE: '9876510004' }));
    expect(await count('leads', a.t)).toBe(1); expect(await count('leads', b.t)).toBe(1);
  });
  it('a refused lead does not burn its id: fixing the phone and resending works', async () => {
    const s = await setup();
    expect((await post(s.pid, s.secret, indiamart('Q5', { SENDER_MOBILE: '123', SENDER_MOBILE_ALT: '' }))).status).toBe(422);
    expect((await post(s.pid, s.secret, indiamart('Q5', { SENDER_MOBILE: '9876510005' }))).status).toBe(200);
    expect(await count('leads', s.t)).toBe(1);
  });
  it('uses the alternate mobile when the main number is a landline', async () => {
    const s = await setup();
    expect((await post(s.pid, s.secret, indiamart('Q6', { SENDER_MOBILE: '0120-2222222', SENDER_MOBILE_ALT: '+91-9876510006' }))).status).toBe(200);
    expect(await contactOf(s.t, '+919876510006')).toBeTruthy();
  });
  it('a plan-full refusal also releases the id so the lead can be accepted after an upgrade', async () => {
    const s = await setup({ plan: 'free' });
    await A(`insert into contacts (tenant_id, phone_e164, consent_status) select '${s.t}', '+9190000' || lpad(g::text, 5, '0'), 'unknown' from generate_series(1, 500) g`);
    expect((await post(s.pid, s.secret, indiamart('Q7', { SENDER_MOBILE: '9876510007' }))).status).toBe(402);
    await A(`update tenants set plan_id = 'growth' where id = '${s.t}'`);
    expect((await post(s.pid, s.secret, indiamart('Q7', { SENDER_MOBILE: '9876510007' }))).status).toBe(200);
  });
});

async function formFor(o: { mode?: string; enabled?: boolean; srcEnabled?: boolean } = {}) {
  const s = await setup({ mode: o.mode ?? 'attested', secret: 'unused', enabled: o.srcEnabled });
  const slug = `form-${tag}-${++n}`;
  await A(`insert into lead_forms (tenant_id, source_id, slug, title, enabled) values ('${s.t}', '${s.sid}', '${slug}', 'Get a quote', ${o.enabled === false ? 'false' : 'true'})`);
  return { ...s, slug };
}
const submit = (slug: string, body: unknown, ct = 'application/json') => submitForm(db, slug, Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)), ct);

describe('hosted forms', () => {
  it('a submission becomes a lead, counted on the form', async () => {
    const f = await formFor();
    expect(await submit(f.slug, { name: 'Asha', phone: '9876520001' })).toMatchObject({ status: 200, created: true });
    expect((await q<any>(sql`select submit_count from lead_forms where slug = ${f.slug}`))[0].submit_count).toBe(1);
  });
  it('needs no key, but an unknown, switched-off form, or switched-off source is refused', async () => {
    expect((await submit('nope-' + tag, { phone: '9876520002' })).status).toBe(404);
    const off = await formFor({ enabled: false }); expect((await submit(off.slug, { phone: '9876520002' })).status).toBe(404);
    const srcOff = await formFor({ srcEnabled: false }); expect((await submit(srcOff.slug, { phone: '9876520002' })).status).toBe(403);
  });
  it('a filled hidden “website” field is a bot: reported as success, nothing stored', async () => {
    const f = await formFor();
    expect(await submit(f.slug, { phone: '9876520003', website: 'http://spam.example' })).toMatchObject({ status: 200 });
    expect(await count('leads', f.t)).toBe(0); expect(await count('contacts', f.t)).toBe(0);
  });
  it('consent follows the source: a ticked box on a “field” form grants offers', async () => {
    const f = await formFor({ mode: 'field' });
    expect(await submit(f.slug, { phone: '9876520004' })).toMatchObject({ consent: 'unknown' });
    expect(await submit(f.slug, { phone: '9876520005', whatsapp_consent: 'yes' })).toMatchObject({ consent: 'allowed' });
  });
  it('a bad phone is explained, not silently accepted', async () => {
    const f = await formFor(); expect((await submit(f.slug, { phone: '12' })).status).toBe(422);
  });
  it('a form cannot be used to reach another workspace’s source', async () => {
    const a = await formFor(), b = await formFor();
    await submit(a.slug, { phone: '9876520006' });
    expect(await count('leads', a.t)).toBe(1); expect(await count('leads', b.t)).toBe(0);
  });
});

describe('Click-to-WhatsApp ad attribution', () => {
  async function inbound(t: string, from: string, referral?: Record<string, unknown>, id = `wamid.${tag}${++n}`) {
    await A(`insert into meta_accounts (tenant_id, messaging_account_id, token_status, health_state) select '${t}', 'wa-${tag}-${n}', 'valid', 'ok' where not exists (select 1 from meta_accounts where tenant_id = '${t}')`);
    return handleInbound(db, t, null, { id, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Is this available?' }, _contacts: [{ wa_id: from, profile: { name: 'Neha Ad' } }], ...(referral ? { referral } : {}) } as any);
  }
  const ad = { source_url: 'https://fb.me/abc', source_id: '120226305854810726', source_type: 'ad', body: 'Summer sale!', headline: 'Chat with us', media_type: 'image', ctwa_clid: 'Aff-click-123' };
  it('an ad click saves the ad on the conversation and creates a lead from the “WhatsApp ads” source', async () => {
    const s = await setup();
    await inbound(s.t, '919876530001', ad);
    const conv = (await q<any>(sql`select ctwa_clid, referral from conversations where tenant_id = ${s.t}`))[0];
    expect(conv.ctwa_clid).toBe('Aff-click-123'); expect(conv.referral).toMatchObject({ source_id: '120226305854810726', headline: 'Chat with us' });
    const l = (await q<any>(sql`select l.utm, l.fields, s.kind, s.name from leads l join lead_sources s on s.id = l.source_id where l.tenant_id = ${s.t}`));
    expect(l).toHaveLength(1); expect(l[0]).toMatchObject({ kind: 'ctwa', name: 'WhatsApp ads' });
    expect(l[0].utm).toMatchObject({ utm_source: 'ctwa', ctwa_clid: 'Aff-click-123' }); expect(l[0].fields).toMatchObject({ ad_id: '120226305854810726', ad_headline: 'Chat with us', ad_text: 'Summer sale!' });
  });
  it('messaging first is NOT marketing consent: the contact stays reply-only', async () => {
    const s = await setup(); await inbound(s.t, '919876530002', ad);
    expect((await contactOf(s.t, '+919876530002')).consent_status).toBe('unknown'); expect(await count('contact_consent_events', s.t)).toBe(0);
  });
  it('a normal message without an ad creates no lead and no source', async () => {
    const s = await setup(); await inbound(s.t, '919876530003');
    expect(await count('leads', s.t)).toBe(0); expect((await q<any>(sql`select 1 from lead_sources where tenant_id = ${s.t} and kind = 'ctwa'`))).toHaveLength(0);
  });
  it('the same customer clicking another ad extends their lead; the system source is created once', async () => {
    const s = await setup();
    await inbound(s.t, '919876530004', ad); await inbound(s.t, '919876530004', { ...ad, source_id: '999', headline: 'Second ad', ctwa_clid: 'Aff-click-456' });
    expect(await count('leads', s.t)).toBe(1); expect((await q<any>(sql`select count(*)::int as n from lead_sources where tenant_id = ${s.t} and kind = 'ctwa'`))[0].n).toBe(1);
    expect((await q<any>(sql`select submissions from leads where tenant_id = ${s.t}`))[0].submissions).toBe(2);
    expect((await q<any>(sql`select ctwa_clid from conversations where tenant_id = ${s.t}`))[0].ctwa_clid).toBe('Aff-click-456');
  });
  it('a replayed webhook does not double count', async () => {
    const s = await setup(); const id = `wamid.same${tag}${n}`;
    await inbound(s.t, '919876530005', ad, id); await inbound(s.t, '919876530005', ad, id);
    expect((await q<any>(sql`select submissions from leads where tenant_id = ${s.t}`))[0].submissions).toBe(1);
  });
  it('a customer who already said STOP stays stopped even if they click an ad', async () => {
    const s = await setup();
    await A(`insert into contacts (tenant_id, phone_e164, consent_status, opt_out_at) values ('${s.t}', '+919876530006', 'stopped', now())`);
    await inbound(s.t, '919876530006', ad);
    expect((await contactOf(s.t, '+919876530006')).consent_status).toBe('stopped');
  });
  it('an ad with a missing or odd referral shape never breaks the message', async () => {
    const s = await setup();
    await inbound(s.t, '919876530007', { weird: { nested: true } }); await inbound(s.t, '919876530008', { source_id: 12345, headline: null });
    expect((await q<any>(sql`select count(*)::int as n from messages where tenant_id = ${s.t}`))[0].n).toBe(2);
  });
  it('a switched-off ads source records the ad on the conversation but makes no lead', async () => {
    const s = await setup(); await inbound(s.t, '919876530009', ad);
    await A(`update lead_sources set enabled = false where tenant_id = '${s.t}' and kind = 'ctwa'`);
    await inbound(s.t, '919876530010', ad);
    expect(await count('leads', s.t)).toBe(1);
    expect((await q<any>(sql`select ctwa_clid from conversations c join contacts k on k.id = c.contact_id where c.tenant_id = ${s.t} and k.phone_e164 = '+919876530010'`))[0].ctwa_clid).toBe('Aff-click-123');
  });
});

describe('spreadsheet import', () => {
  async function importSource(consent: boolean, t?: string) {
    const s = await setup({ mode: 'none' });
    const sid = (await A(`insert into lead_sources (tenant_id, kind, name, public_id, consent_mode${consent ? ', attested_by, attested_at' : ''}) values ('${s.t}', 'import', 'List', 'imp-${tag}-${++n}', '${consent ? 'attested' : 'none'}'${consent ? ", 'owner', now()" : ''}) returning id`))[0]!.id;
    return { ...s, sid, t: t ?? s.t };
  }
  const rowsOf = (...r: [string, string, string?][]) => r.map(([phone, name, email], i) => ({ line: i + 2, phone, name, email }));
  it('adds new people as leads; reply-only unless the owner confirmed consent', async () => {
    const s = await importSource(false);
    const rep = await importLeads(db, s.t, s.sid, rowsOf(['9876540001', 'Asha'], ['98765 40002', 'Ravi', 'r@x.in']));
    expect(rep).toMatchObject({ added: 2, extended: 0, invalid: 0 });
    expect((await contactOf(s.t, '+919876540001')).consent_status).toBe('unknown'); expect(await count('contact_consent_events', s.t)).toBe(0);
  });
  it('with confirmed consent, people become “can send offers” and each gets a consent record', async () => {
    const s = await importSource(true);
    await importLeads(db, s.t, s.sid, rowsOf(['9876540003', 'Meena']));
    expect((await contactOf(s.t, '+919876540003')).consent_status).toBe('allowed'); expect(await count('contact_consent_events', s.t)).toBe(1);
  });
  it('reports invalid numbers and repeats inside the file with line numbers', async () => {
    const s = await importSource(false);
    const rep = await importLeads(db, s.t, s.sid, rowsOf(['9876540004', 'A'], ['12', 'Bad'], ['9876540004', 'Dup'], ['', 'Empty']));
    expect(rep).toMatchObject({ added: 1, invalid: 3 });
    expect(rep.errors.map((e) => e.line)).toEqual([3, 4, 5]); expect(rep.errors[1]!.reason).toMatch(/earlier/);
  });
  it('people already in the workspace extend their open lead instead of duplicating', async () => {
    const s = await importSource(false);
    await importLeads(db, s.t, s.sid, rowsOf(['9876540005', 'Once']));
    const rep = await importLeads(db, s.t, s.sid, rowsOf(['9876540005', 'Again']));
    expect(rep).toMatchObject({ added: 0, extended: 1 }); expect(await count('leads', s.t)).toBe(1);
  });
  it('never un-stops someone, even with confirmed consent', async () => {
    const s = await importSource(true);
    await A(`insert into contacts (tenant_id, phone_e164, consent_status, opt_out_at) values ('${s.t}', '+919876540006', 'stopped', now())`);
    await importLeads(db, s.t, s.sid, rowsOf(['9876540006', 'Stopped']));
    expect((await contactOf(s.t, '+919876540006')).consent_status).toBe('stopped');
  });
  it('stops at the plan’s contact limit and says how many were left out', async () => {
    const s = await setup({ plan: 'free' });
    const sid = (await A(`insert into lead_sources (tenant_id, kind, name, public_id, consent_mode) values ('${s.t}', 'import', 'L', 'imp-${tag}-${++n}', 'none') returning id`))[0]!.id;
    await A(`insert into contacts (tenant_id, phone_e164, consent_status) select '${s.t}', '+9190000' || lpad(g::text, 5, '0'), 'unknown' from generate_series(1, 498) g`);
    const rep = await importLeads(db, s.t, sid, rowsOf(['9876540010', 'a'], ['9876540011', 'b'], ['9876540012', 'c'], ['9876540013', 'd']));
    expect(rep.added).toBe(2); expect(rep.overLimit).toBe(2);
  });
  it('refuses a source that belongs to another workspace', async () => {
    const a = await importSource(false), b = await setup();
    await expect(importLeads(db, b.t, a.sid, rowsOf(['9876540020', 'x']))).rejects.toThrow(/not found/);
    expect(await count('contacts', b.t)).toBe(0);
  });
  it('keeps extra columns as lead fields with safe names', async () => {
    const s = await importSource(false);
    await importLeads(db, s.t, s.sid, [{ line: 2, phone: '9876540030', name: 'X', extra: { 'City Name': 'Agra', 'Budget (₹)': '50k' } }]);
    expect((await q<any>(sql`select fields from leads where tenant_id = ${s.t}`))[0].fields).toEqual({ city_name: 'Agra', budget_: '50k' });
  });
});
