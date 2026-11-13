import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDb, withTenant, tenants, tenantMembers, user, metaAccounts, phoneNumbers, webhookEvents } from '../src';

const APP_URL = process.env.DATABASE_URL ?? 'postgres://app:app_dev_password@localhost:5433/leadbotcloud';
const WORKER_URL = process.env.DATABASE_URL_WORKER ?? 'postgres://worker:worker_dev_password@localhost:5433/leadbotcloud';
// Teardown uses the dev superuser: audit_log is insert-only even for the owner role, by design (same as rls.test.ts).
const OWNER_URL = process.env.DATABASE_URL_ADMIN_TEST ?? 'postgres://postgres:postgres_dev_password@localhost:5433/leadbotcloud';
const app = createDb(APP_URL, { max: 3 });
const worker = createDb(WORKER_URL, { max: 3 });
const owner = createDb(OWNER_URL, { max: 2 });

const A = randomUUID(), B = randomUUID();
const adminA = `mc-admin-a-${A.slice(0, 8)}`, agentA = `mc-agent-a-${A.slice(0, 8)}`, adminB = `mc-admin-b-${B.slice(0, 8)}`;
const WABA_A = `waba-a-${A.slice(0, 8)}`, WABA_B = `waba-b-${B.slice(0, 8)}`;

beforeAll(async () => {
  await worker.db.insert(user).values([adminA, agentA, adminB].map((id) => ({ id, name: id, email: `${id}@example.test` })));
  await worker.db.insert(tenants).values([{ id: A, name: 'MC Tenant A' }, { id: B, name: 'MC Tenant B' }]);
  await worker.db.insert(tenantMembers).values([
    { tenantId: A, userId: adminA, role: 'admin' }, { tenantId: A, userId: agentA, role: 'agent' }, { tenantId: B, userId: adminB, role: 'owner' },
  ]);
});
afterAll(async () => {
  await owner.client.unsafe(`delete from webhook_events where dedupe_key like 'mctest:%'`);
  await owner.client.unsafe(`delete from audit_log where tenant_id in ('${A}','${B}')`);
  await owner.client.unsafe(`delete from tenants where id in ('${A}','${B}')`);
  await owner.client.unsafe(`delete from "user" where id in ('${adminA}','${agentA}','${adminB}')`);
  await Promise.all([app.client.end(), worker.client.end(), owner.client.end()]);
});

const connect = (tenantId: string, userId: string, waba: string, pn: string) =>
  withTenant(app.db, { tenantId, userId }, (tx) =>
    tx.execute(sql`select public.store_meta_connection('biz1', ${waba}, 'v1.fake.cipher.text', '["whatsapp_business_messaging"]'::jsonb, ${pn}, '+91 98765 43210', 'Test Biz', 'v1.pin.cipher.x')`));

describe('Meta connection tables (as app role)', () => {
  it('an admin can store a connection, and it appears for their tenant only', async () => {
    await connect(A, adminA, WABA_A, `pn-a-${A.slice(0, 8)}`);
    await withTenant(app.db, { tenantId: A, userId: adminA }, async (tx) => {
      const r = await tx.select({ id: metaAccounts.id, waba: metaAccounts.messagingAccountId, status: metaAccounts.tokenStatus }).from(metaAccounts);
      expect(r).toHaveLength(1);
      expect(r[0]!.waba).toBe(WABA_A);
      expect(await tx.select({ id: phoneNumbers.id }).from(phoneNumbers)).toHaveLength(1);
    });
    await withTenant(app.db, { tenantId: B, userId: adminB }, async (tx) => {
      expect(await tx.select({ id: metaAccounts.id }).from(metaAccounts)).toHaveLength(0);
      expect(await tx.select({ id: phoneNumbers.id }).from(phoneNumbers)).toHaveLength(0);
    });
  });

  it('the web role can never read the encrypted token or the PIN, even for its own tenant', async () => {
    await withTenant(app.db, { tenantId: A, userId: adminA }, async (tx) => {
      await expect(tx.transaction((sp) => sp.execute(sql`select business_token_enc from meta_accounts`))).rejects.toThrow(/permission denied/);
      await expect(tx.transaction((sp) => sp.execute(sql`select pin_enc from phone_numbers`))).rejects.toThrow(/permission denied/);
      await expect(tx.transaction((sp) => sp.execute(sql`select * from meta_accounts`))).rejects.toThrow(/permission denied/);
    });
  });

  it('the web role cannot write the tables directly', async () => {
    await withTenant(app.db, { tenantId: A, userId: adminA }, async (tx) => {
      await expect(tx.transaction((sp) => sp.execute(sql`update meta_accounts set token_status = 'valid'`))).rejects.toThrow(/permission denied/);
      await expect(tx.transaction((sp) => sp.execute(sql`delete from phone_numbers`))).rejects.toThrow(/permission denied/);
    });
  });

  it('an agent cannot connect WhatsApp (owner or admin only)', async () => {
    await expect(connect(A, agentA, `waba-x-${A.slice(0, 8)}`, 'pn-x')).rejects.toThrow(/owner or admin only/);
  });

  it('a tenant cannot take over a WABA that belongs to another tenant', async () => {
    await expect(connect(B, adminB, WABA_A, `pn-b-${B.slice(0, 8)}`)).rejects.toThrow(/waba_in_use/);
  });

  it('a user cannot connect into a tenant they do not belong to', async () => {
    await expect(connect(B, adminA, WABA_B, 'pn-y')).rejects.toThrow(/owner or admin only/);
  });

  it('reconnecting the same tenant replaces its row instead of duplicating it', async () => {
    await connect(A, adminA, WABA_A, `pn-a-${A.slice(0, 8)}`);
    await withTenant(app.db, { tenantId: A, userId: adminA }, async (tx) => {
      expect(await tx.select({ id: metaAccounts.id }).from(metaAccounts)).toHaveLength(1);
    });
  });
});

describe('webhook_events (worker only)', () => {
  it('the web role cannot read or write raw webhooks at all', async () => {
    await withTenant(app.db, { tenantId: A, userId: adminA }, async (tx) => {
      await expect(tx.transaction((sp) => sp.execute(sql`select 1 from webhook_events`))).rejects.toThrow(/permission denied/);
      await expect(tx.transaction((sp) => sp.execute(sql`insert into webhook_events (signature_ok, dedupe_key, payload) values (true, 'mctest:x', '{}')`))).rejects.toThrow(/permission denied/);
    });
  });
  it('the worker writes once per dedupe key; a replay inserts nothing', async () => {
    const row = { signatureOk: true, dedupeKey: `mctest:${randomUUID()}`, payload: { a: 1 }, wabaId: WABA_A };
    const first = await worker.db.insert(webhookEvents).values(row).onConflictDoNothing().returning({ id: webhookEvents.id });
    const second = await worker.db.insert(webhookEvents).values(row).onConflictDoNothing().returning({ id: webhookEvents.id });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });
});
