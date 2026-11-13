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
const T1 = randomUUID(), T2 = randomUUID(), OWNER = `bil-owner-${tag}`, AGENT = `bil-agent-${tag}`, OTHER = `bil-other-${tag}`;

beforeAll(async () => {
  const u = admin.client.unsafe;
  for (const id of [OWNER, AGENT, OTHER]) await u(`insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('${id}', '${id}', '${id}@example.com', true, now(), now())`);
  await u(`insert into tenants (id, name) values ('${T1}', 'BIL one ${tag}'), ('${T2}', 'BIL two ${tag}')`);
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
const begin = (tx: any, plan: string, sub: string) => tx.execute(sql`select public.begin_checkout(${plan}, ${sub}, ${'plan_' + tag}, ${'https://rzp.io/i/' + sub})`);
const rows = (tx: any, q: any) => tx.execute(q) as Promise<any[]>;

describe('plan cannot be changed from the web role', () => {
  it('a direct UPDATE of tenants.plan_id is refused for the web role', async () => {
    await expect(as(T1, OWNER, (tx) => tx.execute(sql`update tenants set plan_id = 'pro' where id = ${T1}`))).rejects.toThrow(/permission denied/i);
    const t = (await admin.client.unsafe(`select plan_id from tenants where id = '${T1}'`))[0]!;
    expect(t.plan_id).toBe('free');
  });
  it('the web role can still update the other workspace fields', async () => {
    await as(T1, OWNER, (tx) => tx.execute(sql`update tenants set name = ${'BIL renamed ' + tag} where id = ${T1}`));
    const t = (await admin.client.unsafe(`select name from tenants where id = '${T1}'`))[0]!;
    expect(t.name).toBe(`BIL renamed ${tag}`);
  });
  it('the web role cannot write subscriptions, invoices or billing events directly', async () => {
    await expect(as(T1, OWNER, (tx) => tx.execute(sql`insert into subscriptions (tenant_id, plan, razorpay_subscription_id, razorpay_plan_id) values (${T1}, 'pro', 'sub_x', 'plan_x')`))).rejects.toThrow(/permission denied/i);
    await expect(as(T1, OWNER, (tx) => tx.execute(sql`insert into billing_events (dedupe_key, signature_ok, payload) values ('k', true, '{}')`))).rejects.toThrow(/permission denied/i);
    await expect(as(T1, OWNER, (tx) => tx.execute(sql`select * from invoice_counters`))).rejects.toThrow(/permission denied/i);
  });
});

describe('begin_checkout', () => {
  it('lets an owner start a checkout and records it as unpaid', async () => {
    await as(T1, OWNER, (tx) => begin(tx, 'growth', `sub_${tag}_1`));
    const r = await as(T1, OWNER, (tx) => rows(tx, sql`select plan, status, short_url, paid_count from subscriptions`));
    expect(r).toHaveLength(1); expect(r[0]).toMatchObject({ plan: 'growth', status: 'created', paid_count: 0 });
    const t = (await admin.client.unsafe(`select plan_id from tenants where id = '${T1}'`))[0]!;
    expect(t.plan_id).toBe('free'); // starting checkout never grants the plan
  });
  it('refuses an agent', async () => {
    await expect(as(T1, AGENT, (tx) => begin(tx, 'pro', `sub_${tag}_a`))).rejects.toThrow(/owner only/);
  });
  it('refuses a plan that is not for sale', async () => {
    await expect(as(T1, OWNER, (tx) => begin(tx, 'free', `sub_${tag}_f`))).rejects.toThrow();
  });
  it('can replace a checkout that never started, but not a live subscription', async () => {
    await as(T1, OWNER, (tx) => begin(tx, 'pro', `sub_${tag}_2`));
    expect((await as(T1, OWNER, (tx) => rows(tx, sql`select plan, razorpay_subscription_id from subscriptions`)))[0]).toMatchObject({ plan: 'pro', razorpay_subscription_id: `sub_${tag}_2` });
    await admin.client.unsafe(`update subscriptions set status = 'active' where tenant_id = '${T1}'`);
    await expect(as(T1, OWNER, (tx) => begin(tx, 'starter', `sub_${tag}_3`))).rejects.toThrow(/subscription_live/);
  });
  it('is invisible to another workspace', async () => {
    expect(await as(T2, OTHER, (tx) => rows(tx, sql`select * from subscriptions`))).toHaveLength(0);
  });
  it('writes an audit entry', async () => {
    const a = await admin.client.unsafe(`select action from audit_log where tenant_id = '${T1}' and action = 'billing.checkout_started'`);
    expect(a.length).toBeGreaterThanOrEqual(2);
  });
});

describe('note_billing_change', () => {
  it('owner can flag cancel-at-period-end and a pending plan; agent cannot', async () => {
    await as(T1, OWNER, (tx) => tx.execute(sql`select public.note_billing_change(true, 'starter')`));
    expect((await as(T1, OWNER, (tx) => rows(tx, sql`select cancel_at_cycle_end, pending_plan from subscriptions`)))[0]).toMatchObject({ cancel_at_cycle_end: true, pending_plan: 'starter' });
    await expect(as(T1, AGENT, (tx) => tx.execute(sql`select public.note_billing_change(false, null)`))).rejects.toThrow(/owner only/);
  });
});

describe('invoices', () => {
  it('rejects an invoice whose parts do not add up', async () => {
    await expect(admin.client.unsafe(`insert into invoices (tenant_id, number, fy, seq, razorpay_payment_id, plan, base_paise, gst_paise, total_paise, buyer_name) values ('${T1}', 'X/1', '2026-27', 9001, 'pay_bad_${tag}', 'pro', 100, 18, 999, 'Buyer')`)).rejects.toThrow(/invoices_sum_chk/);
  });
  it('refuses a duplicate payment id and a duplicate number', async () => {
    const ins = (n: string, s: number, p: string) => admin.client.unsafe(`insert into invoices (tenant_id, number, fy, seq, razorpay_payment_id, plan, base_paise, gst_paise, total_paise, buyer_name) values ('${T1}', '${n}', '2026-27', ${s}, '${p}', 'pro', 100, 18, 118, 'Buyer')`);
    await ins(`T/${tag}/1`, 9101, `pay_${tag}_1`);
    await expect(ins(`T/${tag}/2`, 9102, `pay_${tag}_1`)).rejects.toThrow(/duplicate key/);
    await expect(ins(`T/${tag}/1`, 9103, `pay_${tag}_3`)).rejects.toThrow(/duplicate key/);
  });
  it('is visible to its own workspace only', async () => {
    expect((await as(T1, OWNER, (tx) => rows(tx, sql`select number from invoices`))).length).toBeGreaterThanOrEqual(1);
    expect(await as(T2, OTHER, (tx) => rows(tx, sql`select number from invoices`))).toHaveLength(0);
  });
});
