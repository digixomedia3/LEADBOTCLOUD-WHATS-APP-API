import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { createDb, withTenant } from '../src';

const src = readFileSync(new URL('./rls.test.ts', import.meta.url), 'utf8');
const pick = (re: RegExp) => re.exec(src)![1]!;
const app = createDb(process.env.DATABASE_URL ?? pick(/const APP_URL = process\.env\.DATABASE_URL \?\? '([^']+)'/), { max: 3 });
const admin = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? pick(/process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/), { max: 2 });
const tag = randomUUID().slice(0, 8);
const T1 = randomUUID(), T2 = randomUUID(), U1 = `ldb-${tag}-1`, U2 = `ldb-${tag}-2`;
let S1 = '', S2 = '', L1 = '', C1 = '';

beforeAll(async () => {
  const u = admin.client.unsafe;
  for (const id of [U1, U2]) await u(`insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('${id}', '${id}', '${id}@example.com', true, now(), now())`);
  await u(`insert into tenants (id, name) values ('${T1}', 'LDB one ${tag}'), ('${T2}', 'LDB two ${tag}')`);
  await u(`insert into tenant_members (tenant_id, user_id, role) values ('${T1}', '${U1}', 'owner'), ('${T2}', '${U2}', 'owner')`);
  S1 = (await u(`insert into lead_sources (tenant_id, name, public_id) values ('${T1}', 'one', 'pub-${tag}-1') returning id`))[0]!.id;
  S2 = (await u(`insert into lead_sources (tenant_id, name, public_id) values ('${T2}', 'two', 'pub-${tag}-2') returning id`))[0]!.id;
  C1 = (await u(`insert into contacts (tenant_id, phone_e164) values ('${T1}', '+919800000001') returning id`))[0]!.id;
  L1 = (await u(`insert into leads (tenant_id, source_id, contact_id) values ('${T1}', '${S1}', '${C1}') returning id`))[0]!.id;
});
afterAll(async () => {
  const u = admin.client.unsafe;
  await u(`delete from audit_log where tenant_id in ('${T1}','${T2}')`);
  await u(`delete from tenants where id in ('${T1}','${T2}')`);
  await u(`delete from "user" where id in ('${U1}','${U2}')`);
  await Promise.all([app.client.end(), admin.client.end()]);
});
const as = <T,>(t: string, u: string, fn: (tx: any) => Promise<T>) => withTenant(app.db, { tenantId: t, userId: u }, fn);
const rows = (tx: any, q: any) => tx.execute(q) as Promise<any[]>;

describe('lead tables: tenant isolation (RLS)', () => {
  it('each workspace sees only its own sources, leads and events', async () => {
    expect((await as(T1, U1, (tx) => rows(tx, sql`select id from lead_sources`))).map((r) => r.id)).toEqual([S1]);
    expect((await as(T2, U2, (tx) => rows(tx, sql`select id from lead_sources`))).map((r) => r.id)).toEqual([S2]);
    expect(await as(T2, U2, (tx) => rows(tx, sql`select id from leads`))).toHaveLength(0);
    expect(await as(T1, U1, (tx) => rows(tx, sql`select id from leads`))).toHaveLength(1);
  });
  it('cannot read or change another workspace’s lead by id', async () => {
    expect(await as(T2, U2, (tx) => rows(tx, sql`select id from leads where id = ${L1}`))).toHaveLength(0);
    const r = await as(T2, U2, (tx) => rows(tx, sql`update leads set status = 'won' where id = ${L1} returning id`));
    expect(r).toHaveLength(0);
    const l = (await admin.client.unsafe(`select status from leads where id = '${L1}'`))[0]!; expect(l.status).toBe('new');
  });
  it('cannot create a source for another workspace', async () => {
    await expect(as(T2, U2, (tx) => tx.execute(sql`insert into lead_sources (tenant_id, name, public_id) values (${T1}, 'sneaky', ${'pub-' + tag + '-x'})`))).rejects.toThrow(/row-level security/i);
  });
});

describe('lead tables: what the web role may write', () => {
  it('cannot create a lead directly (leads only enter through a verified source)', async () => {
    await expect(as(T1, U1, (tx) => tx.execute(sql`insert into leads (tenant_id, contact_id) values (${T1}, ${C1})`))).rejects.toThrow(/permission denied/i);
  });
  it('can change status/owner/value/note but not which contact or workspace a lead belongs to', async () => {
    await as(T1, U1, (tx) => tx.execute(sql`update leads set status = 'qualified', value_paise = 500000, note = 'hot' where id = ${L1}`));
    const l = (await admin.client.unsafe(`select status, value_paise, note from leads where id = '${L1}'`))[0]!; expect(l).toMatchObject({ status: 'qualified', note: 'hot' }); expect(Number(l.value_paise)).toBe(500000);
    await expect(as(T1, U1, (tx) => tx.execute(sql`update leads set contact_id = ${randomUUID()} where id = ${L1}`))).rejects.toThrow(/permission denied/i);
    await expect(as(T1, U1, (tx) => tx.execute(sql`update leads set tenant_id = ${T2} where id = ${L1}`))).rejects.toThrow(/permission denied/i);
  });
  it('refuses an invalid status and a negative deal value', async () => {
    await expect(as(T1, U1, (tx) => tx.execute(sql`update leads set status = 'banana' where id = ${L1}`))).rejects.toThrow(/leads_status_chk/);
    await expect(as(T1, U1, (tx) => tx.execute(sql`update leads set value_paise = -1 where id = ${L1}`))).rejects.toThrow(/leads_value_chk/);
  });
  it('cannot write lead events as the system, only read them and add its own', async () => {
    await as(T1, U1, (tx) => tx.execute(sql`insert into lead_events (tenant_id, lead_id, kind) values (${T1}, ${L1}, 'note')`));
    await expect(as(T1, U1, (tx) => tx.execute(sql`update lead_events set kind = 'x'`))).rejects.toThrow(/permission denied/i);
    await expect(as(T1, U1, (tx) => tx.execute(sql`delete from lead_events`))).rejects.toThrow(/permission denied/i);
  });
  it('cannot insert a rejection record (the worker writes those)', async () => {
    await expect(as(T1, U1, (tx) => tx.execute(sql`insert into lead_rejects (tenant_id, reason) values (${T1}, 'fake')`))).rejects.toThrow(/permission denied/i);
  });
});

describe('lead constraints', () => {
  it('one OPEN lead per contact, but any number of closed ones', async () => {
    const u = admin.client.unsafe;
    await expect(u(`insert into leads (tenant_id, contact_id) values ('${T1}', '${C1}')`)).rejects.toThrow(/leads_one_open_per_contact/);
    await u(`update leads set status = 'won' where id = '${L1}'`);
    await u(`insert into leads (tenant_id, contact_id) values ('${T1}', '${C1}')`);
    await u(`update leads set status = 'lost' where tenant_id = '${T1}' and status = 'new'`);
    await u(`insert into leads (tenant_id, contact_id) values ('${T1}', '${C1}')`);
  });
  it('“attested” consent must record who and when', async () => {
    await expect(admin.client.unsafe(`insert into lead_sources (tenant_id, name, public_id, consent_mode) values ('${T1}', 'a', 'pub-${tag}-att', 'attested')`)).rejects.toThrow(/lead_sources_attest_chk/);
  });
  it('deleting a source keeps the lead and the contact', async () => {
    await admin.client.unsafe(`delete from lead_sources where id = '${S1}'`);
    expect(Number((await admin.client.unsafe(`select count(*)::int as n from leads where tenant_id = '${T1}'`))[0]!.n)).toBeGreaterThan(0);
    expect(Number((await admin.client.unsafe(`select count(*)::int as n from contacts where id = '${C1}'`))[0]!.n)).toBe(1);
  });
});

describe('hosted forms: tenant isolation and the public door', () => {
  let F1 = '', FS1 = '';
  const slug1 = `form-${tag}-one`, slug2 = `form-${tag}-two`;
  beforeAll(async () => {
    const u = admin.client.unsafe;
    FS1 = (await u(`insert into lead_sources (tenant_id, kind, name, public_id) values ('${T1}', 'form', 'Form A', 'pub-${tag}-f1') returning id`))[0]!.id;
    const FS2 = (await u(`insert into lead_sources (tenant_id, kind, name, public_id) values ('${T2}', 'form', 'Form B', 'pub-${tag}-f2') returning id`))[0]!.id;
    F1 = (await u(`insert into lead_forms (tenant_id, source_id, slug, title, intro, consent_text) values ('${T1}', '${FS1}', '${slug1}', 'Get a quote', 'hello', 'I agree to receive WhatsApp messages') returning id`))[0]!.id;
    await u(`insert into lead_forms (tenant_id, source_id, slug, title) values ('${T2}', '${FS2}', '${slug2}', 'Other')`);
  });
  it('each workspace sees only its own forms', async () => {
    expect((await as(T1, U1, (tx) => rows(tx, sql`select slug from lead_forms`))).map((r) => r.slug)).toEqual([slug1]);
    expect((await as(T2, U2, (tx) => rows(tx, sql`select slug from lead_forms`))).map((r) => r.slug)).toEqual([slug2]);
  });
  it('cannot edit or delete another workspace’s form, or point a form at another workspace', async () => {
    expect(await as(T2, U2, (tx) => rows(tx, sql`update lead_forms set title = 'hacked' where id = ${F1} returning id`))).toHaveLength(0);
    expect(await as(T2, U2, (tx) => rows(tx, sql`delete from lead_forms where id = ${F1} returning id`))).toHaveLength(0);
    await expect(as(T2, U2, (tx) => tx.execute(sql`insert into lead_forms (tenant_id, source_id, slug, title) values (${T1}, ${FS1}, ${'form-' + tag + '-evil'}, 'x')`))).rejects.toThrow(/row-level security/i);
  });
  it('rejects bad slugs, bad colours, too many extra fields', async () => {
    const ins = (slug: string, accent = '#10b981', extra = '[]') => admin.client.unsafe(`insert into lead_forms (tenant_id, source_id, slug, title, accent, extra_fields) values ('${T1}', '${FS1}', '${slug}', 'ok', '${accent}', '${extra}')`);
    await expect(ins('Bad Slug!')).rejects.toThrow(/lead_forms_slug_chk/); await expect(ins('abc')).rejects.toThrow(/lead_forms_slug_chk/);
    await expect(ins(`form-${tag}-c`, 'red')).rejects.toThrow(/lead_forms_accent_chk/);
    await expect(ins(`form-${tag}-d`, '#10b981', JSON.stringify(Array.from({ length: 7 }, (_, i) => ({ key: 'k' + i, label: 'L' })))) ).rejects.toThrow(/lead_forms_extra_chk/);
  });
  it('slugs are unique across all workspaces', async () => {
    await expect(admin.client.unsafe(`insert into lead_forms (tenant_id, source_id, slug, title) values ('${T2}', '${FS1}', '${slug1}', 'dup')`)).rejects.toThrow(/duplicate key/);
  });
  it('public_form returns only public fields, with no workspace context', async () => {
    const r = (await app.client.unsafe(`select public.public_form('${slug1}') as f`))[0]!.f;
    expect(r).toMatchObject({ title: 'Get a quote', intro: 'hello', consentText: 'I agree to receive WhatsApp messages', business: `LDB one ${tag}` });
    expect(Object.keys(r).sort()).toEqual(['accent', 'askEmail', 'business', 'buttonText', 'consentText', 'extraFields', 'intro', 'thankYou', 'title']);
    expect(JSON.stringify(r)).not.toContain(T1);
  });
  it('public_form returns nothing for an unknown or switched-off form', async () => {
    expect((await app.client.unsafe(`select public.public_form('nope-${tag}') as f`))[0]!.f).toBeNull();
    await admin.client.unsafe(`update lead_forms set enabled = false where slug = '${slug2}'`);
    expect((await app.client.unsafe(`select public.public_form('${slug2}') as f`))[0]!.f).toBeNull();
  });
  it('the web role cannot read the table without a workspace, so visitors cannot list forms', async () => {
    expect(await app.client.unsafe(`select slug from lead_forms`)).toHaveLength(0);
  });
  it('count_form_view counts only live forms', async () => {
    await app.client.unsafe(`select public.count_form_view('${slug1}')`); await app.client.unsafe(`select public.count_form_view('${slug1}')`); await app.client.unsafe(`select public.count_form_view('${slug2}')`);
    expect((await admin.client.unsafe(`select slug, view_count from lead_forms where slug in ('${slug1}','${slug2}') order by slug`)).map((r) => [r.slug, r.view_count])).toEqual([[slug1, 2], [slug2, 0]]);
  });
  it('external ids: unique per source, readable only by the owning workspace, not writable by the web role', async () => {
    await admin.client.unsafe(`insert into lead_external_ids (source_id, external_id, tenant_id) values ('${FS1}', 'X1', '${T1}')`);
    await expect(admin.client.unsafe(`insert into lead_external_ids (source_id, external_id, tenant_id) values ('${FS1}', 'X1', '${T1}')`)).rejects.toThrow(/duplicate key/);
    expect(await as(T1, U1, (tx) => rows(tx, sql`select external_id from lead_external_ids`))).toHaveLength(1);
    expect(await as(T2, U2, (tx) => rows(tx, sql`select external_id from lead_external_ids`))).toHaveLength(0);
    await expect(as(T1, U1, (tx) => tx.execute(sql`insert into lead_external_ids (source_id, external_id, tenant_id) values (${FS1}, 'X2', ${T1})`))).rejects.toThrow(/permission denied/i);
  });
  it('a workspace has at most one Click-to-WhatsApp ads source', async () => {
    await admin.client.unsafe(`insert into lead_sources (tenant_id, kind, name, public_id) values ('${T1}', 'ctwa', 'WhatsApp ads', 'ctwa-${tag}-1')`);
    await expect(admin.client.unsafe(`insert into lead_sources (tenant_id, kind, name, public_id) values ('${T1}', 'ctwa', 'WhatsApp ads 2', 'ctwa-${tag}-2')`)).rejects.toThrow(/lead_sources_one_ctwa/);
  });
});

describe('connections: tokens are unreadable from the web role', () => {
  let CN1 = '';
  const hash = `h-${tag}`;
  beforeAll(async () => {
    CN1 = (await admin.client.unsafe(`insert into connections (tenant_id, provider, external_id, label, access_token_enc, refresh_token_enc) values ('${T1}', 'shopify', 'shop-${tag}.myshopify.com', 'Shop', 'v1.SECRET.ACCESS', 'v1.SECRET.REFRESH') returning id`))[0]!.id;
  });
  it('the web role can read the safe columns of its own connection', async () => {
    const r = await as(T1, U1, (tx) => rows(tx, sql`select id, provider, label, status, scopes, config from connections`)); expect(r).toHaveLength(1); expect(r[0]).toMatchObject({ provider: 'shopify', label: 'Shop' });
  });
  it('but never the access or refresh token, by any route', async () => {
    await expect(as(T1, U1, (tx) => tx.execute(sql`select access_token_enc from connections`))).rejects.toThrow(/permission denied/i);
    await expect(as(T1, U1, (tx) => tx.execute(sql`select refresh_token_enc from connections`))).rejects.toThrow(/permission denied/i);
    await expect(as(T1, U1, (tx) => tx.execute(sql`select * from connections`))).rejects.toThrow(/permission denied/i);
    await expect(as(T1, U1, (tx) => tx.execute(sql`select to_jsonb(c) from connections c`))).rejects.toThrow(/permission denied/i);
  });
  it('cannot insert, replace a token, retarget, or delete a connection directly', async () => {
    await expect(as(T1, U1, (tx) => tx.execute(sql`insert into connections (tenant_id, provider, external_id, label) values (${T1}, 'shopify', 'x', 'x')`))).rejects.toThrow(/permission denied/i);
    await expect(as(T1, U1, (tx) => tx.execute(sql`update connections set access_token_enc = 'mine'`))).rejects.toThrow(/permission denied/i);
    await expect(as(T1, U1, (tx) => tx.execute(sql`update connections set tenant_id = ${T2}`))).rejects.toThrow(/permission denied/i);
    await expect(as(T1, U1, (tx) => tx.execute(sql`delete from connections`))).rejects.toThrow(/permission denied/i);
  });
  it('can change only the non-secret config, and only on its own connection', async () => {
    await as(T1, U1, (tx) => tx.execute(sql`update connections set config = '{"range":"A1:E500"}'::jsonb, updated_at = now() where id = ${CN1}`));
    expect((await admin.client.unsafe(`select config from connections where id = '${CN1}'`))[0]!.config).toEqual({ range: 'A1:E500' });
    expect(await as(T2, U2, (tx) => rows(tx, sql`update connections set config = '{}'::jsonb where id = ${CN1} returning id`))).toHaveLength(0);
    expect(await as(T2, U2, (tx) => rows(tx, sql`select id from connections`))).toHaveLength(0);
  });
  it('one Page / store belongs to exactly one workspace; unknown providers and statuses are refused', async () => {
    await expect(admin.client.unsafe(`insert into connections (tenant_id, provider, external_id, label) values ('${T2}', 'shopify', 'shop-${tag}.myshopify.com', 'Stolen')`)).rejects.toThrow(/connections_external_uq/);
    await expect(admin.client.unsafe(`insert into connections (tenant_id, provider, external_id, label) values ('${T2}', 'tiktok', 'z', 'z')`)).rejects.toThrow(/connections_provider_chk/);
    await expect(admin.client.unsafe(`update connections set status = 'weird' where id = '${CN1}'`)).rejects.toThrow(/connections_status_chk/);
  });
  it('store_connection: owner/admin only, one workspace per page, makes a keyless source, keeps the old refresh token when none is supplied', async () => {
    const store = (tx: any, ext: string, refresh: string | null = 'v1.R') => tx.execute(sql`select public.store_connection('meta_lead_ads', ${ext}, 'My Page', 'v1.A', ${refresh}, null, ${sql`ARRAY['leads_retrieval']::text[]`}, '{}'::jsonb) as id`);
    await expect(as(T1, U1, async (tx) => { await admin.client.unsafe(`insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('${U1}-agent', 'a', '${U1}-agent@example.com', true, now(), now()) on conflict do nothing`); await admin.client.unsafe(`insert into tenant_members (tenant_id, user_id, role) values ('${T1}', '${U1}-agent', 'agent') on conflict do nothing`); return as(T1, `${U1}-agent`, (t2) => store(t2, `page-${tag}-1`)); })).rejects.toThrow(/owner or admin only/);
    const id = ((await as(T1, U1, (tx) => store(tx, `page-${tag}-1`))) as { id: string }[])[0]!.id;
    const c = (await admin.client.unsafe(`select c.source_id, c.refresh_token_enc, s.kind, s.secret_hash, s.consent_mode, s.enabled from connections c join lead_sources s on s.id = c.source_id where c.id = '${id}'`))[0]!;
    expect(c).toMatchObject({ kind: 'meta_lead_ads', secret_hash: null, consent_mode: 'none', enabled: true, refresh_token_enc: 'v1.R' });
    await as(T1, U1, (tx) => store(tx, `page-${tag}-1`, null));
    expect((await admin.client.unsafe(`select refresh_token_enc from connections where id = '${id}'`))[0]!.refresh_token_enc).toBe('v1.R');
    await expect(as(T2, U2, (tx) => store(tx, `page-${tag}-1`))).rejects.toThrow(/connection_in_use/);
  });
  it('disconnect_connection removes the tokens, switches the source off, keeps leads; owner/admin only; other workspaces cannot', async () => {
    const id = ((await as(T1, U1, (tx) => tx.execute(sql`select public.store_connection('google_sheets', ${'g-' + tag}, 'Sheet', 'v1.A', 'v1.R', null, ${sql`ARRAY[]::text[]`}, '{}'::jsonb) as id`))) as { id: string }[])[0]!.id;
    const src = (await admin.client.unsafe(`select source_id from connections where id = '${id}'`))[0]!.source_id;
    await expect(as(T2, U2, (tx) => tx.execute(sql`select public.disconnect_connection(${id})`))).rejects.toThrow(/not_found/);
    await as(T1, U1, (tx) => tx.execute(sql`select public.disconnect_connection(${id})`));
    expect(await admin.client.unsafe(`select 1 from connections where id = '${id}'`)).toHaveLength(0);
    expect((await admin.client.unsafe(`select enabled from lead_sources where id = '${src}'`))[0]!.enabled).toBe(false);
    expect((await admin.client.unsafe(`select action from audit_log where tenant_id = '${T1}' and action = 'connection.disconnected'`)).length).toBeGreaterThan(0);
  });
  void hash;
});

describe('oauth states: single use, bound to the tenant AND the signed-in user', () => {
  const mk = async (h: string, provider = 'google_sheets', mins = 10) => as(T1, U1, (tx) => tx.execute(sql`insert into oauth_states (state_hash, tenant_id, user_id, provider, extra, expires_at) values (${h}, ${T1}, ${U1}, ${provider}, '{"k":1}'::jsonb, now() + (${mins} || ' minutes')::interval)`));
  const take = (t: string, u: string, h: string, p = 'google_sheets') => as(t, u, async (tx) => (await tx.execute(sql`select public.consume_oauth_state(${h}, ${p}) as s`))[0].s);
  it('works once, then never again', async () => {
    await mk(`st-${tag}-1`); expect(await take(T1, U1, `st-${tag}-1`)).toMatchObject({ extra: { k: 1 } }); expect(await take(T1, U1, `st-${tag}-1`)).toBeNull();
  });
  it('another user in the same workspace cannot use it (someone else’s link finished in your session)', async () => {
    await mk(`st-${tag}-2`); expect(await take(T1, `${U1}-agent`, `st-${tag}-2`)).toBeNull(); expect(await take(T1, U1, `st-${tag}-2`)).not.toBeNull();
  });
  it('another workspace cannot use it either', async () => {
    await mk(`st-${tag}-3`); expect(await take(T2, U2, `st-${tag}-3`)).toBeNull();
  });
  it('is tied to its provider and refuses an expired state', async () => {
    await mk(`st-${tag}-4`, 'shopify'); expect(await take(T1, U1, `st-${tag}-4`, 'google_sheets')).toBeNull(); expect(await take(T1, U1, `st-${tag}-4`, 'shopify')).not.toBeNull();
    await mk(`st-${tag}-5`, 'google_sheets', -5); expect(await take(T1, U1, `st-${tag}-5`)).toBeNull();
  });
  it('peek reads without using it up, with the same ownership checks', async () => {
    await mk(`st-${tag}-6`);
    const peek = (t: string, u: string) => as(t, u, async (tx) => (await tx.execute(sql`select public.peek_oauth_state(${`st-${tag}-6`}, 'google_sheets') as s`))[0].s);
    expect(await peek(T1, U1)).not.toBeNull(); expect(await peek(T1, U1)).not.toBeNull(); expect(await peek(T2, U2)).toBeNull(); expect(await take(T1, U1, `st-${tag}-6`)).not.toBeNull(); expect(await peek(T1, U1)).toBeNull();
  });
  it('the web role cannot read, list, change or insert a state for someone else', async () => {
    await expect(as(T1, U1, (tx) => tx.execute(sql`select * from oauth_states`))).rejects.toThrow(/permission denied/i);
    await expect(as(T1, U1, (tx) => tx.execute(sql`insert into oauth_states (state_hash, tenant_id, user_id, provider, expires_at) values ('x', ${T1}, ${U2}, 'shopify', now() + interval '1 minute')`))).rejects.toThrow(/row-level security/i);
    await expect(as(T1, U1, (tx) => tx.execute(sql`insert into oauth_states (state_hash, tenant_id, user_id, provider, expires_at) values ('y', ${T2}, ${U1}, 'shopify', now() + interval '1 minute')`))).rejects.toThrow(/row-level security/i);
  });
  it('connector_events are invisible to the web role', async () => {
    await expect(as(T1, U1, (tx) => tx.execute(sql`select * from connector_events`))).rejects.toThrow(/permission denied/i);
  });
});
