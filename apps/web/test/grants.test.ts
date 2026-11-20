import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

/** Complimentary plans: staff give a plan for a limited time, with a reason. Real admin actions and real database functions as the `app` role. */
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
let signedIn: string | null = null;
vi.mock('@/lib/session', async () => {
  const t = await import('@/lib/tenant-db');
  return { ...t, VIEW_COOKIE: 'lbc_view', getSession: async () => (signedIn ? { user: { id: signedIn, name: 'N', email: signedIn + '@example.com' } } : null) };
});
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
const rlsSrc = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const ADMIN = process.env.DATABASE_URL_ADMIN_TEST ?? /process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/.exec(rlsSrc)?.[1] ?? '';
if (!ADMIN) throw new Error('Could not find the admin database URL for tests');

describe('complimentary plans (staff gifts)', () => {
  const tag = randomUUID().slice(0, 8);
  const staff = `gp-${tag}-s`, owner = `gp-${tag}-o`, noTf = `gp-${tag}-n`;
  const T = { free: randomUUID(), paying: randomUUID(), halted: randomUUID(), closed: randomUUID(), second: randomUUID() };
  let sql: postgres.Sql; let app: postgres.Sql; let w: postgres.Sql;
  const A = () => import('../src/app/(admin)/admin/actions');
  const asApp = async <T,>(userId: string, q: (tx: postgres.TransactionSql) => Promise<T>) => app.begin(async (tx) => { await tx`select set_config('app.tenant_id', '', true), set_config('app.user_id', ${userId}, true)`; return q(tx); }) as Promise<T>;
  const row = async (id: string) => (await sql`select plan_id, comp_plan, comp_until, comp_reason, comp_granted_by from tenants where id = ${id}`)[0]!;
  const log = (id: string, action: string) => sql`select actor_user_id, actor_type, after from audit_log where tenant_id = ${id} and action = ${action} order by id`;

  beforeAll(async () => {
    sql = postgres(ADMIN, { max: 2 }); app = postgres(process.env.DATABASE_URL!, { max: 3 }); w = postgres(process.env.DATABASE_URL_WORKER ?? process.env.DATABASE_URL!, { max: 1 });
    for (const u of [staff, owner, noTf]) await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${u}, ${u}, ${u + '@example.com'}, true, now(), now())`;
    await sql`insert into platform_admins (user_id) values (${staff}), (${noTf})`; await sql`update "user" set two_factor_enabled = true where id = ${staff}`;
    await sql`insert into tenants (id, name, plan_id, status) values (${T.free}, ${'GP free ' + tag}, 'free', 'ready'), (${T.paying}, ${'GP paying ' + tag}, 'growth', 'ready'), (${T.halted}, ${'GP halted ' + tag}, 'free', 'ready'), (${T.closed}, ${'GP closed ' + tag}, 'free', 'offboarded'), (${T.second}, ${'GP second ' + tag}, 'free', 'ready')`;
    await sql`update tenants set closed_at = now() where id = ${T.closed}`;
    await sql`insert into tenant_members (tenant_id, user_id, role) values (${T.free}, ${owner}, 'owner')`;
    await sql`insert into subscriptions (tenant_id, plan, razorpay_subscription_id, razorpay_plan_id, status) values (${T.paying}, 'growth', ${'sub_gp_' + tag + '_1'}, 'plan_x', 'active'), (${T.halted}, 'starter', ${'sub_gp_' + tag + '_2'}, 'plan_x', 'halted')`;
  });
  afterAll(async () => {
    await sql`delete from audit_log where tenant_id in (${T.free}, ${T.paying}, ${T.halted}, ${T.closed}, ${T.second})`;
    await sql`delete from tenants where id in (${T.free}, ${T.paying}, ${T.halted}, ${T.closed}, ${T.second})`; await sql`delete from "user" where id like ${'gp-' + tag + '%'}`;
    const left = Number((await sql`select count(*)::int n from tenants where id in (${T.free}, ${T.paying}, ${T.halted}, ${T.closed}, ${T.second})`)[0]!.n);
    await sql.end(); await app.end(); await w.end(); if (left) throw new Error('grant test left workspaces behind');
  });

  describe('who may give a plan', () => {
    it('only staff with two-step sign-in, through the app and straight at the database', async () => {
      const a = await A();
      signedIn = null; await expect(a.grantPlan(T.free, 'pro', 30, 'fine reason')).rejects.toThrow('NEXT_NOT_FOUND');
      signedIn = owner; await expect(a.grantPlan(T.free, 'pro', 30, 'fine reason')).rejects.toThrow('NEXT_NOT_FOUND'); await expect(a.endGrant(T.free, 'fine reason')).rejects.toThrow('NEXT_NOT_FOUND'); await expect(a.loadPlan(T.free)).rejects.toThrow('NEXT_NOT_FOUND');
      signedIn = noTf; await expect(a.grantPlan(T.free, 'pro', 30, 'fine reason')).rejects.toThrow('NEXT_NOT_FOUND');
      for (const u of [owner, noTf]) {       // the database functions refuse the same people even when called directly (staff without two-step too)
        await expect(asApp(u, async (tx) => tx`select public.admin_grant_plan(${T.free}::uuid, 'pro', 30, 'fine reason')`)).rejects.toThrow(/platform admin only/);
        await expect(asApp(u, async (tx) => tx`select public.admin_end_grant(${T.free}::uuid, 'fine reason')`)).rejects.toThrow(/platform admin only/);
      }
      expect((await row(T.free)).plan_id).toBe('free'); expect((await row(T.free)).comp_plan).toBeNull();
    });
    it('a customer cannot write the grant columns themselves, not even as the owner of the workspace', async () => {
      await expect(asApp(owner, async (tx) => { await tx`select set_config('app.tenant_id', ${T.free}, true)`; return tx`update tenants set comp_plan = 'pro', comp_until = now() + interval '30 days', comp_reason = 'self', comp_granted_by = ${owner}, comp_granted_at = now() where id = ${T.free}`; })).rejects.toThrow(/permission denied|row-level/i);
      await expect(asApp(owner, async (tx) => { await tx`select set_config('app.tenant_id', ${T.free}, true)`; return tx`update tenants set plan_id = 'pro' where id = ${T.free}`; })).rejects.toThrow(/permission denied|row-level/i);
      expect((await row(T.free)).plan_id).toBe('free');
    });
  });

  describe('giving a plan', () => {
    it('validates the plan, the days and the reason, and the workspace', async () => {
      signedIn = staff; const a = await A();
      for (const [why, r] of [
        ['free as a gift', await a.grantPlan(T.free, 'free', 30, 'fine reason')], ['unknown plan', await a.grantPlan(T.free, 'platinum', 30, 'fine reason')],
        ['zero days', await a.grantPlan(T.free, 'pro', 0, 'fine reason')], ['366 days', await a.grantPlan(T.free, 'pro', 366, 'fine reason')], ['negative days', await a.grantPlan(T.free, 'pro', -3, 'fine reason')], ['not a number', await a.grantPlan(T.free, 'pro', NaN, 'fine reason')],
        ['no reason', await a.grantPlan(T.free, 'pro', 30, '')], ['short reason', await a.grantPlan(T.free, 'pro', 30, ' abc ')], ['long reason', await a.grantPlan(T.free, 'pro', 30, 'x'.repeat(201))],
        ['missing workspace', await a.grantPlan(randomUUID(), 'pro', 30, 'fine reason')], ['bad id', await a.grantPlan('nope', 'pro', 30, 'fine reason')], ['closed workspace', await a.grantPlan(T.closed, 'pro', 30, 'fine reason')],
      ] as const) expect(r.ok, why).toBe(false);
      expect(await row(T.free)).toMatchObject({ plan_id: 'free', comp_plan: null });
    });
    it('gives the plan at once, until the right date, with the reason and who gave it; the customer\'s own log shows it', async () => {
      signedIn = staff; const a = await A(); const before = Date.now();
      const r = await a.grantPlan(T.free, 'pro', 30, '  Pilot customer, ticket 123  ');
      expect(r.ok && r.data.plan).toBe('pro'); const x = await row(T.free); expect(x).toMatchObject({ plan_id: 'pro', comp_plan: 'pro', comp_reason: 'Pilot customer, ticket 123', comp_granted_by: staff });
      const days = (new Date(x.comp_until).getTime() - before) / 86_400_000; expect(days).toBeGreaterThan(29.99); expect(days).toBeLessThan(30.01);
      const [l] = await log(T.free, 'admin.plan_granted'); expect(l!.actor_user_id).toBe(staff); expect(l!.actor_type).toBe('super_admin'); expect(l!.after).toMatchObject({ plan: 'pro', days: 30, reason: 'Pilot customer, ticket 123', from: 'free' });
      const mine = await asApp(owner, async (tx) => { await tx`select set_config('app.tenant_id', ${T.free}, true)`; return tx`select action from audit_log where action = 'admin.plan_granted'`; }); expect(mine.length).toBe(1);
    });
    it('a new grant replaces the old one (it does not stack), and can move down as well as up', async () => {
      signedIn = staff; const a = await A();
      await a.grantPlan(T.free, 'starter', 10, 'Smaller gift now'); const x = await row(T.free); expect(x).toMatchObject({ plan_id: 'starter', comp_plan: 'starter' });
      expect((new Date(x.comp_until).getTime() - Date.now()) / 86_400_000).toBeLessThan(10.01);
    });
    it('refuses a workspace that pays (active, authenticated, pending, halted or paused): that belongs to billing', async () => {
      signedIn = staff; const a = await A();
      for (const t of [T.paying, T.halted]) { const r = await a.grantPlan(t, 'pro', 30, 'fine reason'); expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/paid subscription/); expect((await row(t)).comp_plan).toBeNull(); }
      expect((await row(T.paying)).plan_id).toBe('growth');
      await sql`update subscriptions set status = 'cancelled' where razorpay_subscription_id = ${'sub_gp_' + tag + '_2'}`;
      expect((await a.grantPlan(T.halted, 'pro', 5, 'Their card failed; thank-you week')).ok).toBe(true);       // a cancelled subscription no longer blocks a gift
    });
    it('the database itself keeps a grant within 366 days, with a real reason and an end date', async () => {
      await expect(sql`update tenants set comp_plan = 'pro', comp_until = now() + interval '2 years', comp_reason = 'too long', comp_granted_by = ${staff}, comp_granted_at = now() where id = ${T.second}`).rejects.toThrow(/tenants_comp_chk/);
      await expect(sql`update tenants set comp_plan = 'pro', comp_until = now() - interval '1 day', comp_reason = 'in the past', comp_granted_by = ${staff}, comp_granted_at = now() where id = ${T.second}`).rejects.toThrow(/tenants_comp_chk/);
      await expect(sql`update tenants set comp_plan = 'free', comp_until = now() + interval '1 day', comp_reason = 'free is no gift', comp_granted_by = ${staff}, comp_granted_at = now() where id = ${T.second}`).rejects.toThrow(/tenants_comp_chk/);
      await expect(sql`update tenants set comp_plan = 'pro' where id = ${T.second}`).rejects.toThrow(/tenants_comp_chk/);
    });
  });

  describe('ending a grant early', () => {
    it('needs a reason, falls back to what is paid for, logs it, and is safe to repeat', async () => {
      signedIn = staff; const a = await A();
      expect((await a.endGrant(T.free, '')).ok).toBe(false); expect((await row(T.free)).comp_plan).toBe('starter');
      const r = await a.endGrant(T.free, 'Pilot over, thanks'); expect(r).toEqual({ ok: true, data: { ended: true, plan: 'free' } });
      expect(await row(T.free)).toMatchObject({ plan_id: 'free', comp_plan: null, comp_until: null, comp_reason: null, comp_granted_by: null });
      const [l] = await log(T.free, 'admin.grant_ended'); expect(l!.after).toMatchObject({ plan: 'starter', reason: 'Pilot over, thanks', now: 'free' });
      expect(await a.endGrant(T.free, 'Again, to be sure')).toEqual({ ok: true, data: { ended: false } });
    });
  });

  describe('what staff see', () => {
    it('the plan, what it pays for, and the grant, in plain data', async () => {
      signedIn = staff; const a = await A(); await a.grantPlan(T.second, 'growth', 14, 'Show me the card');
      const g = await a.loadPlan(T.second); expect(g.ok && g.data).toMatchObject({ plan: 'growth', effective: 'growth', paid: null, grant: { plan: 'growth', reason: 'Show me the card', live: true, by: staff + '@example.com' } });
      const p = await a.loadPlan(T.paying); expect(p.ok && p.data).toMatchObject({ plan: 'growth', effective: 'growth', paid: { plan: 'growth', status: 'active' }, grant: null });
      expect(await a.loadPlan(randomUUID())).toEqual({ ok: true, data: null }); expect(await a.loadPlan('nope')).toEqual({ ok: true, data: null });
      await a.endGrant(T.second, 'Done showing');
    });
  });

  describe('gaps found by deliberately breaking the code', () => {
    it('the plan details are staff only, even when the database function is called directly', async () => {
      for (const u of [owner]) await expect(asApp(u, async (tx) => tx`select public.admin_plan_info(${T.free}::uuid)`)).rejects.toThrow(/platform admin only/);
    });
    it('the details say whether a gift is still running, and say so correctly once its date has passed', async () => {
      const t = randomUUID(); await sql`insert into tenants (id, name) values (${t}, ${'GP live ' + tag})`;
      try {
        await sql`update tenants set comp_plan = 'pro', comp_until = now() + interval '1 hour', comp_reason = 'live flag test', comp_granted_by = ${staff}, comp_granted_at = now() - interval '2 days' where id = ${t}`;
        const live = await asApp(staff, async (tx) => (await tx`select public.admin_plan_info(${t}::uuid) as p`)[0]!.p as { grant: { live: boolean }; effective: string }); expect(live.grant.live).toBe(true); expect(live.effective).toBe('pro');
        await sql`update tenants set comp_until = now() - interval '1 minute' where id = ${t}`;
        const over = await asApp(staff, async (tx) => (await tx`select public.admin_plan_info(${t}::uuid) as p`)[0]!.p as { grant: { live: boolean }; effective: string }); expect(over.grant.live).toBe(false); expect(over.effective).toBe('free');
      } finally { await sql`delete from tenants where id = ${t}`; }
    });
    it('each rule is enforced with its own plain message, not just by the table constraint', async () => {
      signedIn = staff; const a = await A();
      const msg = async (r: Promise<{ ok: boolean; error?: string }>) => { const x = await r; return x.ok ? '' : (x.error ?? ''); };
      expect(await msg(a.grantPlan(T.second, 'free', 30, 'fine reason'))).toMatch(/Starter, Growth or Pro/);
      expect(await msg(a.grantPlan(T.second, 'pro', 0, 'fine reason'))).toMatch(/between 1 and 365 days/);
      expect(await msg(a.grantPlan(T.second, 'pro', 366, 'fine reason'))).toMatch(/between 1 and 365 days/);
      expect(await msg(a.grantPlan(T.second, 'pro', 30, 'abc'))).toMatch(/at least 5 characters/);
      expect(await msg(a.grantPlan(T.second, 'pro', 30, 'x'.repeat(201)))).toMatch(/too long/);
      expect(await msg(a.endGrant(T.second, 'abc'))).toMatch(/at least 5 characters/);
    });
  });

  describe('the rule for the plan a workspace gets (effective_plan)', () => {
    const eff = async (t: string) => (await sql`select public.effective_plan(${t}::uuid) as p`)[0]!.p as string;
    it('is free with nothing, the paid plan when paying, the grant when gifted, and the BETTER of the two when both', async () => {
      const t = randomUUID(); await sql`insert into tenants (id, name) values (${t}, ${'GP eff ' + tag})`;
      try {
        expect(await eff(t)).toBe('free');
        await sql`update tenants set comp_plan = 'pro', comp_until = now() + interval '5 days', comp_reason = 'rule test', comp_granted_by = ${staff}, comp_granted_at = now() where id = ${t}`; expect(await eff(t)).toBe('pro');
        await sql`insert into subscriptions (tenant_id, plan, razorpay_subscription_id, razorpay_plan_id, status) values (${t}, 'starter', ${'sub_gp_' + tag + '_e'}, 'plan_x', 'active')`; expect(await eff(t)).toBe('pro');       // grant is better than the paid plan
        await sql`update tenants set comp_plan = 'starter' where id = ${t}`; await sql`update subscriptions set plan = 'growth' where tenant_id = ${t}`; expect(await eff(t)).toBe('growth');     // paid plan is better than the grant
        await sql`update subscriptions set status = 'cancelled' where tenant_id = ${t}`; expect(await eff(t)).toBe('starter');          // only the grant is left
        await sql`update tenants set comp_until = now() - interval '1 second', comp_granted_at = now() - interval '2 days' where id = ${t}`.catch(() => undefined);
      } finally { await sql`delete from tenants where id = ${t}`; }
    });
    it('ignores a grant whose date has passed, and a subscription that is not active', async () => {
      const t = randomUUID(); await sql`insert into tenants (id, name) values (${t}, ${'GP eff2 ' + tag})`;
      try {
        await sql`update tenants set comp_plan = 'growth', comp_until = now() + interval '1 hour', comp_reason = 'will lapse', comp_granted_by = ${staff}, comp_granted_at = now() - interval '1 day' where id = ${t}`;
        expect(await eff(t)).toBe('growth'); await sql`set constraints all immediate`;
        await sql`alter table tenants disable trigger user`; await sql`update tenants set comp_until = now() - interval '1 minute', comp_granted_at = now() - interval '2 days' where id = ${t}`; await sql`alter table tenants enable trigger user`;
        expect(await eff(t)).toBe('free');
        await sql`insert into subscriptions (tenant_id, plan, razorpay_subscription_id, razorpay_plan_id, status) values (${t}, 'pro', ${'sub_gp_' + tag + '_f'}, 'plan_x', 'created')`; expect(await eff(t)).toBe('free');       // created, not yet paid
      } finally { await sql`delete from tenants where id = ${t}`; }
    });
  });
});
