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
