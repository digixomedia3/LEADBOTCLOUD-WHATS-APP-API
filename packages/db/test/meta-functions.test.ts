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
const T1 = randomUUID(), T2 = randomUUID(), OWNER = `mcx-owner-${tag}`, AGENT = `mcx-agent-${tag}`, OTHER = `mcx-other-${tag}`;

beforeAll(async () => {
  const u = admin.client.unsafe;
  for (const id of [OWNER, AGENT, OTHER]) await u(`insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('${id}', '${id}', '${id}@example.com', true, now(), now())`);
  await u(`insert into tenants (id, name) values ('${T1}', 'MCX one ${tag}'), ('${T2}', 'MCX two ${tag}')`);
  await u(`insert into tenant_members (tenant_id, user_id, role) values ('${T1}', '${OWNER}', 'owner'), ('${T1}', '${AGENT}', 'agent'), ('${T2}', '${OTHER}', 'owner')`);
});
afterAll(async () => {
  const u = admin.client.unsafe;
  await u(`delete from audit_log where tenant_id in ('${T1}','${T2}')`);
  await u(`delete from tenants where id in ('${T1}','${T2}')`);
  await u(`delete from "user" where id in ('${OWNER}','${AGENT}','${OTHER}')`);
  await Promise.all([app.client.end(), admin.client.end()]);
});

const as = <T,>(tenantId: string, userId: string, fn: (tx: any) => Promise<T>) => withTenant(app.db, { tenantId, userId }, fn);
const store = (tx: any, waba: string, pn: string) => tx.execute(sql`select public.store_meta_connection('B1', ${waba}, 'v1.enc.token.cipher', '["whatsapp_business_management"]'::jsonb, ${pn}, '+91 98765 43210', 'Shop', 'v1.enc.pin.cipher')`);
const status = (tx: any) => tx.execute(sql`select public.update_meta_status('GREEN','CONNECTED','TIER_1K','APPROVED','CLOUD_API','LIVE',false,'VERIFIED',true,'ONBOARDED',false,true)`);

describe('Meta connection functions', () => {
  it('an owner can store a connection and then update its status', async () => {
    await as(T1, OWNER, async (tx) => { await store(tx, `waba-${tag}`, `pn-${tag}`); await status(tx); });
    const r = (await as(T1, OWNER, (tx) => tx.execute(sql`select a.token_status, a.mm_api_status, a.subscribed_apps_ok, p.quality_rating, p.status, p.messaging_limit_tier, p.throughput_level, p.registered_at from meta_accounts a join phone_numbers p on p.meta_account_id = a.id`))) as any[];
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ token_status: 'valid', mm_api_status: 'ONBOARDED', subscribed_apps_ok: true, quality_rating: 'GREEN', status: 'CONNECTED', throughput_level: 'TIER_1K' });
    expect(r[0].messaging_limit_tier).toBeNull(); // throughput is not the daily limit tier
    expect(r[0].registered_at).not.toBeNull();
  });
  it('the web role can never read the token or the PIN back, even for its own tenant', async () => {
    await expect(as(T1, OWNER, (tx) => tx.execute(sql`select business_token_enc from meta_accounts`))).rejects.toThrow(/permission denied/i);
    await expect(as(T1, OWNER, (tx) => tx.execute(sql`select pin_enc from phone_numbers`))).rejects.toThrow(/permission denied/i);
    await expect(as(T1, OWNER, (tx) => tx.execute(sql`select * from meta_accounts`))).rejects.toThrow(/permission denied/i);
  });
  it('an agent cannot store, update or disconnect', async () => {
    await expect(as(T1, AGENT, (tx) => store(tx, `waba-x-${tag}`, `pn-x-${tag}`))).rejects.toThrow(/owner or admin only/);
    await expect(as(T1, AGENT, (tx) => status(tx))).rejects.toThrow(/owner or admin only/);
    await expect(as(T1, AGENT, (tx) => tx.execute(sql`select public.disconnect_meta()`))).rejects.toThrow(/owner or admin only/);
  });
  it('a member of another tenant cannot act on this tenant even when they name it', async () => {
    await expect(as(T1, OTHER, (tx) => status(tx))).rejects.toThrow(/owner or admin only/);
  });
  it('one WhatsApp account cannot be connected to two workspaces', async () => {
    await expect(as(T2, OTHER, (tx) => store(tx, `waba-${tag}`, `pn-other-${tag}`))).rejects.toThrow(/waba_in_use/);
    expect(((await as(T2, OTHER, (tx) => tx.execute(sql`select count(*)::int n from meta_accounts`))) as any[])[0].n).toBe(0);
  });
  it('tenant two never sees tenant one\'s connection', async () => {
    expect(((await as(T2, OTHER, (tx) => tx.execute(sql`select count(*)::int n from phone_numbers`))) as any[])[0].n).toBe(0);
  });
  it('disconnect revokes the token, deletes the number, and pauses running campaigns', async () => {
    await admin.client.unsafe(`insert into campaigns (tenant_id, name, status) values ('${T1}', 'running one', 'running'), ('${T1}', 'sched one', 'scheduled'), ('${T1}', 'done one', 'completed')`);
    await as(T1, OWNER, (tx) => tx.execute(sql`select public.disconnect_meta()`));
    const a = await admin.client.unsafe(`select token_status, business_token_enc from meta_accounts where tenant_id = '${T1}'`);
    expect(a[0]).toMatchObject({ token_status: 'revoked', business_token_enc: 'revoked' });
    expect((await admin.client.unsafe(`select count(*)::int n from phone_numbers where tenant_id = '${T1}'`))[0]!.n).toBe(0);
    const c = await admin.client.unsafe(`select name, status, pause_reason from campaigns where tenant_id = '${T1}' order by name`);
    expect(c).toEqual([{ name: 'done one', status: 'completed', pause_reason: null }, { name: 'running one', status: 'paused', pause_reason: 'disconnected' }, { name: 'sched one', status: 'paused', pause_reason: 'disconnected' }]);
  });
  it('after disconnect the same workspace can reconnect', async () => {
    await as(T1, OWNER, (tx) => store(tx, `waba-${tag}`, `pn2-${tag}`));
    expect((await admin.client.unsafe(`select token_status from meta_accounts where tenant_id = '${T1}'`))[0]!.token_status).toBe('valid');
  });
});
