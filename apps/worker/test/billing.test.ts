import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '@lbc/db';
import { ingestBilling, processBillingEvent } from '../src/billing';

const src = (await import('node:fs')).readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const pick = (re: RegExp) => re.exec(src)![1]!;
const w = createDb(process.env.DATABASE_URL_WORKER ?? pick(/process\.env\.DATABASE_URL_WORKER \?\?\s*'([^']+)'/), { max: 4 });
const admin = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? pick(/process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/), { max: 2 });
const db = w.db;
const SECRET = 'whsec_test';
const tag = randomUUID().slice(0, 8);
const q = async <T = any>(s: ReturnType<typeof sql>) => (await db.execute(s)) as unknown as T[];

afterAll(async () => {
  const u = admin.client.unsafe;
  await u(`delete from billing_events where payload::text like '%${tag}%'`);
  await u(`delete from invoices where buyer_name like 'BL ${tag}%'`);
  await u(`delete from audit_log where tenant_id in (select id from tenants where name like 'BL ${tag}%')`);
  await u(`delete from tenants where name like 'BL ${tag}%'`);
  await u(`delete from razorpay_plans where razorpay_plan_id like 'plan_${tag}%'`);
  await Promise.all([w.client.end(), admin.client.end()]);
});

let n = 0;
async function tenantWithSub(plan = 'growth', status = 'created') {
  const t = randomUUID(), i = ++n, sid = `sub_${tag}_${i}`;
  await admin.client.unsafe(`insert into tenants (id, name, legal_name, gstin) values ('${t}', 'BL ${tag} ${i}', 'BL ${tag} Pvt Ltd ${i}', '27AAAAA0000A1Z5')`);
  await admin.client.unsafe(`insert into subscriptions (tenant_id, plan, razorpay_subscription_id, razorpay_plan_id, status) values ('${t}', '${plan}', '${sid}', 'plan_${tag}_${plan}', '${status}')`);
  await admin.client.unsafe(`insert into razorpay_plans (plan, amount_paise, razorpay_plan_id) values ('${plan}', ${i * 1000 + 1}, 'plan_${tag}_${plan}${i}') on conflict do nothing`);
  return { t, sid, rzpPlan: `plan_${tag}_${plan}${i}` };
}
const entity = (sid: string, plan: string, status: string, over: Record<string, unknown> = {}) => ({
  id: sid, entity: 'subscription', plan_id: plan, customer_id: 'cust_1', status, current_start: 1_800_000_000, current_end: 1_802_592_000, paid_count: 1, notes: [], tag, ...over,
});
const body = (event: string, sub: object, pay?: object, at = 1_800_000_100) => JSON.stringify({ entity: 'event', event, created_at: at, payload: { subscription: { entity: sub }, ...(pay ? { payment: { entity: pay } } : {}) } });
const sign = (b: string, s = SECRET) => createHmac('sha256', s).update(b).digest('hex');
async function deliver(b: string, eventId: string, sig = sign(b)) {
  const r = await ingestBilling(db, Buffer.from(b), sig, eventId, SECRET);
  const out = r.id !== null ? await processBillingEvent(db, r.id) : null;
  return { r, out };
}
const plan = async (t: string) => (await q<{ plan_id: string }>(sql`select plan_id from tenants where id = ${t}`))[0]!.plan_id;
const subRow = async (t: string) => (await q<any>(sql`select * from subscriptions where tenant_id = ${t}`))[0];
const pay = (id: string, amount = 153_282) => ({ id, amount, currency: 'INR', status: 'captured', invoice_id: 'inv_1', method: 'card' });

describe('receiving Razorpay webhooks', () => {
  it('refuses to run with no secret configured', async () => { expect((await ingestBilling(db, Buffer.from('{}'), 'x', 'e', undefined)).status).toBe(503); });
  it('rejects a forged signature, records the attempt, and changes nothing', async () => {
    const { t, sid, rzpPlan } = await tenantWithSub();
    const b = body('subscription.activated', entity(sid, rzpPlan, 'active'));
    const { r } = await deliver(b, `e-forged-${tag}`, sign(b, 'attacker-secret'));
    expect(r.status).toBe(401); expect(r.id).toBeNull();
    expect(await plan(t)).toBe('free'); expect((await subRow(t)).status).toBe('created');
    const bad = await q(sql`select 1 from billing_events where signature_ok = false and received_at > now() - interval '1 minute'`);
    expect(bad.length).toBeGreaterThan(0);
  });
  it('rejects a payload edited after signing', async () => {
    const { sid, rzpPlan } = await tenantWithSub();
    const b = body('subscription.activated', entity(sid, rzpPlan, 'created'));
    const sig = sign(b);
    expect((await ingestBilling(db, Buffer.from(b.replace('created', 'active')), sig, `e-edit-${tag}`, SECRET)).status).toBe(401);
  });
  it('treats a repeated delivery of the same event as a duplicate and applies it once', async () => {
    const { t, sid, rzpPlan } = await tenantWithSub();
    const b = body('subscription.activated', entity(sid, rzpPlan, 'active'));
    const a = await deliver(b, `e-dup-${tag}`); const again = await deliver(b, `e-dup-${tag}`);
    expect(a.out).toBe('applied'); expect(again.r.duplicate).toBe(true); expect(again.out).toBeNull();
    expect(await plan(t)).toBe('growth');
  });
});

describe('granting and removing a plan', () => {
  it('stays on free until Razorpay says the subscription is active', async () => {
    const { t, sid, rzpPlan } = await tenantWithSub('pro');
    await deliver(body('subscription.authenticated', entity(sid, rzpPlan, 'authenticated', { paid_count: 0 })), `e-auth-${tag}-${n}`);
    expect(await plan(t)).toBe('free'); expect((await subRow(t)).status).toBe('authenticated');
  });
  it('grants the plan on activation, using the plan Razorpay reports, not anything in notes', async () => {
    const { t, sid, rzpPlan } = await tenantWithSub('growth');
    await deliver(body('subscription.activated', entity(sid, rzpPlan, 'active', { notes: { plan: 'pro', tenant_id: 'someone-else' } })), `e-act-${tag}-${n}`);
    expect(await plan(t)).toBe('growth');
    const s = await subRow(t); expect(s.status).toBe('active'); expect(s.current_end).not.toBeNull();
  });
  it('returns the workspace to free when the subscription is cancelled or halted, and keeps the data', async () => {
    for (const end of ['cancelled', 'halted', 'completed']) {
      const { t, sid, rzpPlan } = await tenantWithSub('starter');
      await admin.client.unsafe(`update tenants set plan_id = 'starter' where id = '${t}'`);
      await admin.client.unsafe(`insert into contacts (tenant_id, phone_e164, name, consent_status) values ('${t}', '+9199${String(n).padStart(8, '0')}', 'Keep me', 'allowed')`);
      await deliver(body(`subscription.${end}`, entity(sid, rzpPlan, end)), `e-end-${end}-${tag}-${n}`);
      expect(await plan(t)).toBe('free');
      expect(Number((await q(sql`select count(*)::int as c from contacts where tenant_id = ${t}`))[0].c)).toBe(1);
    }
  });
  it('a failed renewal (pending) does not remove the plan; only halted does', async () => {
    const { t, sid, rzpPlan } = await tenantWithSub('growth');
    await deliver(body('subscription.activated', entity(sid, rzpPlan, 'active')), `e-p1-${tag}-${n}`);
    await deliver(body('subscription.pending', entity(sid, rzpPlan, 'pending'), undefined, 1_800_000_200), `e-p2-${tag}-${n}`);
    expect(await plan(t)).toBe('growth'); expect((await subRow(t)).status).toBe('pending');
    await deliver(body('subscription.halted', entity(sid, rzpPlan, 'halted'), undefined, 1_800_000_300), `e-p3-${tag}-${n}`);
    expect(await plan(t)).toBe('free');
  });
  it('an older event arriving late never overwrites a newer state', async () => {
    const { t, sid, rzpPlan } = await tenantWithSub('growth');
    await deliver(body('subscription.cancelled', entity(sid, rzpPlan, 'cancelled'), undefined, 1_800_000_900), `e-new-${tag}-${n}`);
    const late = await deliver(body('subscription.activated', entity(sid, rzpPlan, 'active'), undefined, 1_800_000_100), `e-old-${tag}-${n}`);
    expect(late.out).toBe('stale'); expect(await plan(t)).toBe('free'); expect((await subRow(t)).status).toBe('cancelled');
  });
  it('maps an upgrade to the new plan from our own catalogue', async () => {
    const { t, sid, rzpPlan } = await tenantWithSub('growth');
    await deliver(body('subscription.activated', entity(sid, rzpPlan, 'active')), `e-u1-${tag}-${n}`);
    const proId = `plan_${tag}_pro_x${n}`;
    await admin.client.unsafe(`insert into razorpay_plans (plan, amount_paise, razorpay_plan_id) values ('pro', ${n * 1000 + 7}, '${proId}')`);
    await deliver(body('subscription.updated', entity(sid, proId, 'active'), undefined, 1_800_000_500), `e-u2-${tag}-${n}`);
    expect(await plan(t)).toBe('pro'); expect((await subRow(t)).plan).toBe('pro');
  });
});

describe('invoices', () => {
  it('makes exactly one GST invoice per captured payment, with base + GST adding up to what was charged', async () => {
    const { t, sid, rzpPlan } = await tenantWithSub('growth');
    const b = body('subscription.charged', entity(sid, rzpPlan, 'active'), pay(`pay_${tag}_a${n}`, 153_282));
    const a = await deliver(b, `e-c1-${tag}-${n}`);
    expect(a.out).toBe('invoiced');
    const inv = await q<any>(sql`select * from invoices where tenant_id = ${t}`);
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ base_paise: 129_900, gst_paise: 23_382, total_paise: 153_282, plan: 'growth', buyer_gstin: '27AAAAA0000A1Z5' });
    expect(inv[0].buyer_name).toContain(`BL ${tag} Pvt Ltd`);
    expect(inv[0].number).toMatch(/^LBC\/\d{4}-\d{2}\/\d{6}$/);
    expect(await plan(t)).toBe('growth');
  });
  it('does not invoice twice if the same payment arrives under a different event id', async () => {
    const { t, sid, rzpPlan } = await tenantWithSub('growth');
    const b = body('subscription.charged', entity(sid, rzpPlan, 'active'), pay(`pay_${tag}_b${n}`));
    await deliver(b, `e-c2-${tag}-${n}`);
    const again = await deliver(b + ' ', `e-c3-${tag}-${n}`, sign(b + ' '));
    expect(again.out).toBe('duplicate_payment');
    expect(await q(sql`select 1 from invoices where tenant_id = ${t}`)).toHaveLength(1);
  });
  it('still invoices money received even when the event is older than the current state', async () => {
    const { t, sid, rzpPlan } = await tenantWithSub('growth');
    await deliver(body('subscription.activated', entity(sid, rzpPlan, 'active'), undefined, 1_800_000_900), `e-l1-${tag}-${n}`);
    const late = await deliver(body('subscription.charged', entity(sid, rzpPlan, 'active'), pay(`pay_${tag}_c${n}`), 1_800_000_100), `e-l2-${tag}-${n}`);
    expect(late.out).toBe('invoiced'); expect(await q(sql`select 1 from invoices where tenant_id = ${t}`)).toHaveLength(1);
  });
  it('numbers consecutive invoices without gaps or repeats, even when issued concurrently', async () => {
    const made = await Promise.all(Array.from({ length: 6 }, async (_, k) => {
      const { t, sid, rzpPlan } = await tenantWithSub('starter');
      await deliver(body('subscription.charged', entity(sid, rzpPlan, 'active'), pay(`pay_${tag}_k${n}_${k}`, 58_882)), `e-k-${tag}-${n}-${k}`);
      return (await q<{ seq: number; fy: string }>(sql`select seq, fy from invoices where tenant_id = ${t}`))[0]!;
    }));
    const seqs = made.map((m) => m.seq).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(6);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]! - seqs[i - 1]!).toBe(1);
  });
});

describe('robustness', () => {
  it('throws (so the queue retries) when the subscription is not known yet, and applies once it is', async () => {
    const sid = `sub_${tag}_late`; const t = randomUUID();
    await admin.client.unsafe(`insert into tenants (id, name) values ('${t}', 'BL ${tag} late')`);
    const b = body('subscription.activated', entity(sid, `plan_${tag}_x`, 'active'));
    const r = await ingestBilling(db, Buffer.from(b), sign(b), `e-race-${tag}`, SECRET);
    await expect(processBillingEvent(db, r.id!)).rejects.toThrow(/unknown_subscription/);
    await admin.client.unsafe(`insert into subscriptions (tenant_id, plan, razorpay_subscription_id, razorpay_plan_id) values ('${t}', 'starter', '${sid}', 'plan_${tag}_x')`);
    expect(await processBillingEvent(db, r.id!)).toBe('applied');
    expect(await plan(t)).toBe('starter');
  });
  it('acknowledges and stores event types it does not act on, without changing anything', async () => {
    const { t, sid, rzpPlan } = await tenantWithSub('growth');
    const b = JSON.stringify({ event: 'payment.authorized', created_at: 1, payload: { payment: { entity: { id: 'pay_z', amount: 1, tag } } }, sid });
    const r = await ingestBilling(db, Buffer.from(b), sign(b), `e-other-${tag}`, SECRET);
    expect(await processBillingEvent(db, r.id!)).toBe('ignored'); expect(await plan(t)).toBe('free');
  });
  it('stores a signed non-JSON body for review instead of crashing', async () => {
    const b = `not json ${tag}`;
    const r = await ingestBilling(db, Buffer.from(b), sign(b), `e-junk-${tag}`, SECRET);
    expect(r.status).toBe(200);
  });
  it('processing the same stored event twice is harmless', async () => {
    const { t, sid, rzpPlan } = await tenantWithSub('growth');
    const b = body('subscription.charged', entity(sid, rzpPlan, 'active'), pay(`pay_${tag}_r${n}`));
    const r = await ingestBilling(db, Buffer.from(b), sign(b), `e-twice-${tag}-${n}`, SECRET);
    await processBillingEvent(db, r.id!); expect(await processBillingEvent(db, r.id!)).toBe('ignored');
    expect(await q(sql`select 1 from invoices where tenant_id = ${t}`)).toHaveLength(1);
  });
});
