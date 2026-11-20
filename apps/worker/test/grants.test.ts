import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '@lbc/db';
import { ingestBilling, processBillingEvent } from '../src/billing';
import { expireGrants } from '../src/grants';

/**
 * Complimentary plans in the worker: a gift ends by itself, and a payment (or the end of a subscription) can never quietly remove a gift or invent a plan.
 */
const src = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const pick = (re: RegExp) => re.exec(src)![1]!;
const w = createDb(process.env.DATABASE_URL_WORKER ?? pick(/process\.env\.DATABASE_URL_WORKER \?\?\s*'([^']+)'/), { max: 4 });
const admin = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? pick(/process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/), { max: 2 });
const db = w.db; const A = admin.client.unsafe;
const SECRET = 'whsec_test'; const tag = randomUUID().slice(0, 8); const STAFF = `gw-${tag}`;
const q = async <T = any>(s: ReturnType<typeof sql>) => (await db.execute(s)) as unknown as T[];

afterAll(async () => {
  await A(`delete from billing_events where payload::text like '%${tag}%'`); await A(`delete from invoices where buyer_name like 'GW ${tag}%'`);
  await A(`delete from audit_log where tenant_id in (select id from tenants where name like 'GW ${tag}%')`);
  await A(`delete from tenants where name like 'GW ${tag}%'`); await A(`delete from razorpay_plans where razorpay_plan_id like 'plan_gw_${tag}%'`); await A(`delete from "user" where id = '${STAFF}'`);
  const left = Number((await A(`select count(*)::int n from tenants where name like 'GW ${tag}%'`))[0]!.n);
  await Promise.all([w.client.end(), admin.client.end()]); if (left) throw new Error('grant worker test left workspaces behind');
});

let n = 0;
/** A workspace, optionally with a gift (days from now; negative = already past) and a subscription. */
async function ws(o: { grant?: { plan: string; days: number }; sub?: { plan: string; status: string }; plan?: string } = {}) {
  const t = randomUUID(), i = ++n;
  await A(`insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('${STAFF}', 's', '${STAFF}@example.com', true, now(), now()) on conflict do nothing`);
  await A(`insert into tenants (id, name, legal_name, gstin, plan_id) values ('${t}', 'GW ${tag} ${i}', 'GW ${tag} Pvt ${i}', '27AAAAA0000A1Z5', '${o.plan ?? 'free'}')`);
  if (o.grant) {
    // Past dates are written by shifting both ends back, because the database refuses a grant that ends before it begins.
    const back = o.grant.days < 0 ? Math.abs(o.grant.days) + 2 : 0;
    await A(`update tenants set comp_plan = '${o.grant.plan}', comp_until = now() + interval '${o.grant.days} days', comp_reason = 'worker test', comp_granted_by = '${STAFF}', comp_granted_at = now() - interval '${back} days' where id = '${t}'`);
  }
  const sid = `sub_gw_${tag}_${i}`, rzp = `plan_gw_${tag}_${i}`;
  if (o.sub) {
    await A(`insert into subscriptions (tenant_id, plan, razorpay_subscription_id, razorpay_plan_id, status) values ('${t}', '${o.sub.plan}', '${sid}', '${rzp}', '${o.sub.status}')`);
    await A(`insert into razorpay_plans (plan, amount_paise, razorpay_plan_id) values ('${o.sub.plan}', ${i * 1000 + 7}, '${rzp}') on conflict do nothing`);
  }
  return { t, sid, rzp };
}
const planOf = async (t: string) => (await q<{ plan_id: string }>(sql`select plan_id, comp_plan from tenants where id = ${t}`))[0]!.plan_id;
const grantOf = async (t: string) => (await q<{ comp_plan: string | null; comp_until: Date | null }>(sql`select comp_plan, comp_until from tenants where id = ${t}`))[0]!;
const entity = (sid: string, plan: string, status: string) => ({ id: sid, entity: 'subscription', plan_id: plan, customer_id: 'cust_1', status, current_start: 1_800_000_000, current_end: 1_802_592_000, paid_count: 1, notes: [], tag });
let at = 1_800_000_100;
async function event(name: string, sid: string, rzp: string, status: string) {
  const body = JSON.stringify({ entity: 'event', event: name, created_at: ++at, payload: { subscription: { entity: entity(sid, rzp, status) } } });
  const r = await ingestBilling(db, Buffer.from(body), createHmac('sha256', SECRET).update(body).digest('hex'), `e-${tag}-${at}`, SECRET);
  return processBillingEvent(db, r.id!);
}
const audit = (t: string, action: string) => A(`select actor_type, after from audit_log where tenant_id = '${t}' and action = '${action}' order by id`) as unknown as Promise<{ actor_type: string; after: Record<string, unknown> }[]>;

describe('gifts end by themselves', () => {
  it('a gift whose date has passed is cleared and the plan falls back to free; a live one is left alone', async () => {
    const gone = await ws({ plan: 'pro', grant: { plan: 'pro', days: -3 } }), live = await ws({ plan: 'pro', grant: { plan: 'pro', days: 20 } });
    const r = await expireGrants(db); expect(r.expired).toBeGreaterThanOrEqual(1);
    expect(await grantOf(gone.t)).toEqual({ comp_plan: null, comp_until: null }); expect(await planOf(gone.t)).toBe('free');
    expect((await grantOf(live.t)).comp_plan).toBe('pro'); expect(await planOf(live.t)).toBe('pro');
  });
  it('writes who and what to the log, as the system, with the plan it fell back to', async () => {
    const g = await ws({ plan: 'growth', grant: { plan: 'growth', days: -1 } }); await expireGrants(db);
    const [l] = await audit(g.t, 'billing.grant_expired'); expect(l!.actor_type).toBe('system'); expect(l!.after).toMatchObject({ plan: 'growth', now: 'free' });
  });
  it('falls back to the paid plan when there is one, never to free over a real subscription', async () => {
    const g = await ws({ plan: 'pro', grant: { plan: 'pro', days: -2 }, sub: { plan: 'starter', status: 'active' } }); await expireGrants(db);
    expect(await planOf(g.t)).toBe('starter'); const [l] = await audit(g.t, 'billing.grant_expired'); expect(l!.after).toMatchObject({ now: 'starter' });
  });
  it('is safe to run twice, and ends each gift once', async () => {
    const g = await ws({ plan: 'pro', grant: { plan: 'pro', days: -4 } });
    const [a, b] = await Promise.all([expireGrants(db), expireGrants(db)]); expect(a.expired + b.expired).toBeGreaterThanOrEqual(1);
    expect((await audit(g.t, 'billing.grant_expired')).length).toBe(1); expect((await expireGrants(db)).expired).toBe(0);
  });
  it('works through a long queue in batches without skipping anyone', async () => {
    const ids: string[] = []; for (let i = 0; i < 7; i++) ids.push((await ws({ plan: 'starter', grant: { plan: 'starter', days: -5 } })).t);
    let total = 0; for (let k = 0; k < 10; k++) { const r = await expireGrants(db, { limit: 3 }); total += r.expired; if (!r.expired) break; }
    expect(total).toBeGreaterThanOrEqual(7); for (const t of ids) { expect((await grantOf(t)).comp_plan).toBeNull(); expect(await planOf(t)).toBe('free'); }
  });
  it('never touches a workspace that has no gift, whatever its plan', async () => {
    const f = await ws({ plan: 'free' }), p = await ws({ plan: 'growth', sub: { plan: 'growth', status: 'active' } }); await expireGrants(db);
    expect(await planOf(f.t)).toBe('free'); expect(await planOf(p.t)).toBe('growth');
  });
});

describe('payments and a gift', () => {
  it('a payment on a workspace holding a bigger gift leaves it with the bigger plan, and keeps the gift', async () => {
    const g = await ws({ plan: 'pro', grant: { plan: 'pro', days: 30 }, sub: { plan: 'starter', status: 'created' } });
    expect(await event('subscription.activated', g.sid, g.rzp, 'active')).toBe('applied');
    expect(await planOf(g.t)).toBe('pro'); expect((await grantOf(g.t)).comp_plan).toBe('pro');
  });
  it('a payment for a bigger plan than the gift gives the bigger plan', async () => {
    const g = await ws({ plan: 'starter', grant: { plan: 'starter', days: 30 }, sub: { plan: 'growth', status: 'created' } });
    await event('subscription.activated', g.sid, g.rzp, 'active'); expect(await planOf(g.t)).toBe('growth');
  });
  it('when the subscription ends, a gift that is still running keeps its plan; without one it goes to free', async () => {
    const g = await ws({ plan: 'growth', grant: { plan: 'pro', days: 30 }, sub: { plan: 'growth', status: 'active' } });
    await event('subscription.cancelled', g.sid, g.rzp, 'cancelled'); expect(await planOf(g.t)).toBe('pro');
    const n2 = await ws({ plan: 'growth', sub: { plan: 'growth', status: 'active' } }); await event('subscription.cancelled', n2.sid, n2.rzp, 'cancelled'); expect(await planOf(n2.t)).toBe('free');
  });
  it('an expired gift is not revived by a billing event', async () => {
    const g = await ws({ plan: 'pro', grant: { plan: 'pro', days: -3 }, sub: { plan: 'starter', status: 'created' } });
    await event('subscription.activated', g.sid, g.rzp, 'active'); expect(await planOf(g.t)).toBe('starter');
  });
});

describe('gaps found by deliberately breaking the code', () => {
  it('the batch limit is respected: a limit of 2 ends at most 2 gifts in one pass, oldest first, and the rest wait for the next pass', async () => {
    await expireGrants(db, { limit: 500 });       // clear anything left over from the other tests first
    const ids: string[] = []; for (let i = 0; i < 5; i++) ids.push((await ws({ plan: 'starter', grant: { plan: 'starter', days: -(10 - i) } })).t);       // oldest end date first
    const first = await expireGrants(db, { limit: 2 }); expect(first.expired).toBe(2);
    expect((await grantOf(ids[0]!)).comp_plan).toBeNull(); expect((await grantOf(ids[1]!)).comp_plan).toBeNull(); expect((await grantOf(ids[2]!)).comp_plan).toBe('starter');
    expect((await expireGrants(db, { limit: 2 })).expired).toBe(2); expect((await expireGrants(db, { limit: 2 })).expired).toBe(1); expect((await expireGrants(db, { limit: 2 })).expired).toBe(0);
  });
  it('a limit outside 1 to 500 is brought back inside it', async () => {
    await ws({ plan: 'starter', grant: { plan: 'starter', days: -3 } }); expect((await expireGrants(db, { limit: 0 })).expired).toBe(1);
    await ws({ plan: 'starter', grant: { plan: 'starter', days: -3 } }); expect((await expireGrants(db, { limit: -5 })).expired).toBe(1);
    await ws({ plan: 'starter', grant: { plan: 'starter', days: -3 } }); expect((await expireGrants(db, { limit: Number.NaN })).expired).toBe(1);        // a bad number falls back to the default instead of crashing
    await ws({ plan: 'starter', grant: { plan: 'starter', days: -3 } }); expect((await expireGrants(db, { limit: '7' as unknown as number })).expired).toBe(1); expect((await expireGrants(db, { limit: Infinity })).expired).toBe(0);
  });
  it('two passes at the same moment never end the same gift twice, even with a large queue', async () => {
    const ids: string[] = []; for (let i = 0; i < 6; i++) ids.push((await ws({ plan: 'growth', grant: { plan: 'growth', days: -2 } })).t);
    const rs = await Promise.all([expireGrants(db, { limit: 50 }), expireGrants(db, { limit: 50 }), expireGrants(db, { limit: 50 })]);
    expect(rs.reduce((n, r) => n + r.expired, 0)).toBeGreaterThanOrEqual(6);
    for (const t of ids) expect((await audit(t, 'billing.grant_expired')).length).toBe(1);
  });
});
