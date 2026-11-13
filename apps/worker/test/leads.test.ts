import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '@lbc/db';
import { hashSecret, ingestLead } from '../src/leads';

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
