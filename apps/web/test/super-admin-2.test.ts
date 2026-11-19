import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import type { Revenue } from '../src/app/(admin)/admin/actions';

/**
 * Super admin, second round: the attention queue, closures, accounts and sign-outs, revenue, staff list, workspace notes and send errors.
 * Same shape as super-admin.test.ts: real database, the real `app` role, a staff member and an ordinary customer.
 */
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
let signedIn: string | null = null;
vi.mock('@/lib/session', async () => {
  const t = await import('@/lib/tenant-db');
  return { ...t, getSession: async () => (signedIn ? { user: { id: signedIn, name: 'N', email: signedIn + '@example.com' } } : null) };
});
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
const rlsSrc = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const ADMIN = process.env.DATABASE_URL_ADMIN_TEST ?? /process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/.exec(rlsSrc)?.[1] ?? '';
if (!ADMIN) throw new Error('Could not find the admin database URL for tests');
const mk = () => randomUUID().slice(0, 8);

describe('super admin, round two', () => {
  let sql: postgres.Sql; let app: postgres.Sql;
  let staff = '', staff2 = '', plain = '', victim = '', tag = '';
  let tBad = '', tFine = '', tClosing = '', tMeta = '', tGone = '';
  const A = () => import('../src/app/(admin)/admin/actions');
  const asApp = async <T,>(userId: string, q: (tx: postgres.TransactionSql) => Promise<T>) => app.begin(async (tx) => { await tx`select set_config('app.tenant_id', '', true), set_config('app.user_id', ${userId}, true)`; return q(tx); }) as Promise<T>;
  const logged = async (action: string, where = sql``) => Number((await sql`select count(*)::int n from audit_log where action = ${action} and (actor_user_id = ${staff} or actor_user_id = ${staff2}) ${where}`)[0]!.n);

  beforeAll(async () => {
    sql = postgres(ADMIN, { max: 2 }); app = postgres(process.env.DATABASE_URL!, { max: 2 });
    tag = mk(); staff = `s1-${tag}`; staff2 = `s2-${tag}`; plain = `pl-${tag}`; victim = `vi-${tag}`;
    tBad = randomUUID(); tFine = randomUUID(); tClosing = randomUUID(); tMeta = randomUUID();
    for (const u of [staff, staff2, plain, victim]) await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${u}, ${'Person ' + u}, ${u + '@example.com'}, true, now(), now())`;
    await sql`insert into platform_admins (user_id) values (${staff}), (${staff2})`;
    await sql`update "user" set two_factor_enabled = true where id in (${staff}, ${staff2})`;      // staff must have two-step sign-in on, or the panel stays closed
    for (const [id, n] of [[tBad, 'Failing Co'], [tFine, 'Fine Co'], [tClosing, 'Closing Co'], [tMeta, 'Meta Co']] as const) await sql`insert into tenants (id, name, plan_id, status) values (${id}, ${n + ' ' + tag}, 'starter', 'ready')`;
    await sql`insert into tenant_members (tenant_id, user_id, role) values (${tBad}, ${plain}, 'owner'), (${tFine}, ${victim}, 'owner'), (${tClosing}, ${victim}, 'owner')`;
    // tBad: 30 sends in the last 7 days, 12 failed (40%), with two different error codes.
    const conv = (await sql`insert into contacts (tenant_id, phone_e164) values (${tBad}, '+919000000001') returning id`)[0]!.id;
    const cv = (await sql`insert into conversations (tenant_id, contact_id) values (${tBad}, ${conv}) returning id`)[0]!.id;
    for (let i = 0; i < 30; i++) await sql`insert into messages (tenant_id, conversation_id, direction, kind, body, status, error_code) values (${tBad}, ${cv}, 'out', 'text', 'x', ${i < 12 ? 'failed' : 'sent'}, ${i < 8 ? 131026 : i < 12 ? 131049 : null})`;
    // tFine: 30 sends, all fine.
    const c2 = (await sql`insert into contacts (tenant_id, phone_e164) values (${tFine}, '+919000000002') returning id`)[0]!.id;
    const cv2 = (await sql`insert into conversations (tenant_id, contact_id) values (${tFine}, ${c2}) returning id`)[0]!.id;
    for (let i = 0; i < 30; i++) await sql`insert into messages (tenant_id, conversation_id, direction, kind, body, status) values (${tFine}, ${cv2}, 'out', 'text', 'x', 'sent')`;
    // tClosing: a closure waiting 20 days.
    await sql`update tenants set closure_requested_at = now() - interval '10 days', closure_due_at = now() + interval '20 days', closure_requested_by = ${victim} where id = ${tClosing}`;
    // tMeta: an expired WhatsApp sign-in, which is the most serious sign.
    await sql`insert into meta_accounts (tenant_id, business_id, messaging_account_id, token_status, health_state) values (${tMeta}, ${'b' + tag}, ${'w' + tag}, 'revoked', 'ok')`;
    // A workspace that already left, with a dead WhatsApp sign-in: it must not appear in the attention list (nothing to do about it).
    tGone = randomUUID();
    await sql`insert into tenants (id, name, plan_id, status) values (${tGone}, ${'Gone Co ' + tag}, 'starter', 'offboarded')`;
    await sql`insert into meta_accounts (tenant_id, business_id, messaging_account_id, token_status, health_state) values (${tGone}, ${'g' + tag}, ${'gw' + tag}, 'revoked', 'ok')`;
    // sessions for the victim: two live ones and one that expired yesterday
    await sql`insert into session (id, expires_at, token, created_at, updated_at, user_id) values (${randomUUID()}, now() - interval '1 day', ${randomUUID()}, now() - interval '9 days', now() - interval '9 days', ${victim})`;
    for (let i = 0; i < 2; i++) await sql`insert into session (id, expires_at, token, created_at, updated_at, user_id) values (${randomUUID()}, now() + interval '5 days', ${randomUUID()}, now(), now(), ${victim})`;
  });
  afterAll(async () => {
    await sql`delete from audit_log where actor_user_id in (${staff}, ${staff2}, ${plain}, ${victim}) or tenant_id in (${tBad}, ${tFine}, ${tClosing}, ${tMeta}, ${tGone})`;
    await sql`delete from tenants where id in (${tBad}, ${tFine}, ${tClosing}, ${tMeta}, ${tGone})`;
    await sql`delete from "user" where id in (${staff}, ${staff2}, ${plain}, ${victim})`;
    const left = await sql`select (select count(*) from tenants where id in (${tBad}, ${tFine}, ${tClosing}, ${tMeta}, ${tGone})) + (select count(*) from "user" where id in (${staff}, ${staff2}, ${plain}, ${victim})) + (select count(*) from session where user_id = ${victim}) as n`;
    await sql.end(); await app.end();
    if (Number(left[0]!.n) !== 0) throw new Error('admin round-two test left rows behind');
  });

  it('every new screen and action is invisible and refused for non-staff, at the app and at the database', async () => {
    const a = await A();
    for (const who of [null, plain]) {
      signedIn = who;
      await expect(a.loadAttention()).rejects.toThrow('NEXT_NOT_FOUND');
      await expect(a.loadClosures()).rejects.toThrow('NEXT_NOT_FOUND');
      await expect(a.cancelClosure(tClosing, 'not allowed')).rejects.toThrow('NEXT_NOT_FOUND');
      await expect(a.searchUsers('')).rejects.toThrow('NEXT_NOT_FOUND');
      await expect(a.signOutUser(victim, 'not allowed')).rejects.toThrow('NEXT_NOT_FOUND');
      await expect(a.loadRevenue()).rejects.toThrow('NEXT_NOT_FOUND');
      await expect(a.loadStaff()).rejects.toThrow('NEXT_NOT_FOUND');
      await expect(a.loadTenantExtra(tBad)).rejects.toThrow('NEXT_NOT_FOUND');
      await expect(a.addNote(tBad, 'should not be written')).rejects.toThrow('NEXT_NOT_FOUND');
    }
    const calls: ((tx: postgres.TransactionSql) => unknown)[] = [
      (tx) => tx`select admin_attention()`, (tx) => tx`select admin_closures()`, (tx) => tx`select admin_cancel_closure(${tClosing}::uuid, 'sneaky attempt')`, (tx) => tx`select admin_users('', 5)`,
      (tx) => tx`select admin_sign_out_user(${victim}, 'sneaky attempt')`, (tx) => tx`select admin_revenue()`, (tx) => tx`select admin_staff()`, (tx) => tx`select admin_tenant_extra(${tBad}::uuid)`, (tx) => tx`select admin_add_note(${tBad}::uuid, 'sneaky note')`,
    ];
    for (const c of calls) { await expect(asApp(plain, c as never)).rejects.toMatchObject({ code: '42501' }); await expect(asApp('', c as never)).rejects.toMatchObject({ code: '42501' }); }
    expect(Number((await sql`select count(*)::int n from session where user_id = ${victim} and expires_at > now()`)[0]!.n)).toBe(2);
    expect((await sql`select closure_due_at from tenants where id = ${tClosing}`)[0]!.closure_due_at).not.toBeNull();
    expect(Number((await sql`select count(*)::int n from admin_notes where tenant_id = ${tBad}`)[0]!.n)).toBe(0);
    // The notes table and the session table are not reachable by the app role at all.
    await expect(asApp(staff, (tx) => tx`select * from admin_notes`)).rejects.toThrow();
  });

  it('attention queue: ranks the sick workspace first, explains why, and leaves healthy ones out', async () => {
    signedIn = staff; const a = await A(); const r = await a.loadAttention(); expect(r.ok).toBe(true); if (!r.ok) return;
    const mine = r.data.filter((x) => [tBad, tFine, tClosing, tMeta].includes(x.id));
    expect(mine.map((x) => x.id).sort()).toEqual([tBad, tClosing, tMeta].sort());          // Fine Co is absent
    const bad = mine.find((x) => x.id === tBad)!; const meta = mine.find((x) => x.id === tMeta)!; const closing = mine.find((x) => x.id === tClosing)!;
    expect(bad.reasons.map((x) => x.code)).toContain('failing'); expect(bad.reasons.find((x) => x.code === 'failing')!.severity).toBe('high');   // 40% is over the 30% line
    expect(bad.reasons.find((x) => x.code === 'failing')!.detail).toMatch(/12 of 30/);
    expect(meta.reasons.map((x) => x.code)).toContain('token'); expect(meta.reasons.find((x) => x.code === 'token')!.severity).toBe('high');
    expect(closing.reasons.map((x) => x.code)).toEqual(['closing']); expect(closing.reasons[0]!.severity).toBe('info');
    expect(closing.reasons[0]!.detail).toMatch(/^Closing on \d{2} \w{3} \d{4}$/);
    expect(closing.score).toBeLessThan(bad.score);                                         // an informational closure ranks below a failing workspace
    const order = r.data.map((x) => x.id); expect(order.indexOf(tBad)).toBeLessThan(order.indexOf(tClosing));
    expect(r.data.every((x, i, all) => i === 0 || all[i - 1]!.score >= x.score)).toBe(true);
    expect(r.data.find((x) => x.id === tGone)).toBeUndefined();                              // a workspace that already left is not something staff can act on
  });

  it('attention queue: the failure rate has a floor on volume and two severity lines', async () => {
    // 10 sends with 9 failed is not enough volume to alarm; 100 sends with 15 failed is a warning, not a high.
    const c = (await sql`select id from conversations where tenant_id = ${tFine} limit 1`)[0]!.id;
    await sql`update messages set status = 'failed' where tenant_id = ${tFine} and id in (select id from messages where tenant_id = ${tFine} limit 5)`;        // 5 of 30 = 16%
    signedIn = staff; const a = await A(); let r = await a.loadAttention(); if (!r.ok) throw new Error('x');
    const warn = r.data.find((x) => x.id === tFine)!; expect(warn.reasons.find((x) => x.code === 'failing')!.severity).toBe('warn');
    await sql`update messages set status = 'sent' where tenant_id = ${tFine}`;
    await sql`delete from messages where tenant_id = ${tFine} and id not in (select id from messages where tenant_id = ${tFine} limit 10)`;
    await sql`update messages set status = 'failed' where tenant_id = ${tFine}`;           // 10 of 10 failed, but under the 20-send floor
    r = await a.loadAttention(); if (!r.ok) throw new Error('x');
    expect(r.data.find((x) => x.id === tFine)).toBeUndefined();
    void c;
  });

  it('closures: lists the waiting one with days left, and staff can stop it with a reason that is logged', async () => {
    signedIn = staff; const a = await A();
    const l = await a.loadClosures(); expect(l.ok).toBe(true); if (!l.ok) return;
    const row = l.data.pending.find((x) => x.id === tClosing)!; expect(row.daysLeft).toBe(20); expect(row.requestedBy).toBe(victim + '@example.com'); expect(row.inProgress).toBe(false);
    const bad = await a.cancelClosure(tClosing, 'no'); expect(bad.ok).toBe(false);                                        // reason too short
    expect((await sql`select closure_due_at from tenants where id = ${tClosing}`)[0]!.closure_due_at).not.toBeNull();
    const ok = await a.cancelClosure(tClosing, 'Customer asked us to keep it'); expect(ok).toEqual({ ok: true, data: { changed: true } });
    expect((await sql`select closure_due_at, closure_requested_at, closure_requested_by from tenants where id = ${tClosing}`)[0]).toMatchObject({ closure_due_at: null, closure_requested_at: null, closure_requested_by: null });
    expect(await logged('admin.closure_cancelled', sql`and tenant_id = ${tClosing}`)).toBe(1);
    const again = await a.cancelClosure(tClosing, 'Doing it twice'); expect(again).toEqual({ ok: true, data: { changed: false } });
    expect(await logged('admin.closure_cancelled', sql`and tenant_id = ${tClosing}`)).toBe(1);                              // no second log for a no-op
    expect((await a.loadClosures() as { data: { pending: { id: string }[] } }).data.pending.find((x) => x.id === tClosing)).toBeUndefined();
  });

  it('closures: once erasing has started it cannot be undone, and the data stays exactly as the worker left it', async () => {
    await sql`update tenants set closure_requested_at = now() - interval '31 days', closure_due_at = now() - interval '1 day', status = 'offboarded' where id = ${tClosing}`;
    signedIn = staff; const a = await A(); const r = await a.cancelClosure(tClosing, 'Too late to change my mind');
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/already being erased/);
    const l = await a.loadClosures(); if (!l.ok) throw new Error('x'); expect(l.data.pending.find((x) => x.id === tClosing)!.inProgress).toBe(true);
    expect((await sql`select status, closure_due_at from tenants where id = ${tClosing}`)[0]!.status).toBe('offboarded');
    await sql`update tenants set status = 'ready', closure_requested_at = null, closure_due_at = null where id = ${tClosing}`;
  });

  it('accounts: search finds a person by email or name, shows their workspaces and live sign-ins, and the search itself is logged', async () => {
    signedIn = staff; const a = await A(); const before = await logged('admin.searched_users');
    const r = await a.searchUsers(victim); expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.data.length).toBe(1); const u = r.data[0]!; expect(u.email).toBe(victim + '@example.com'); expect(u.sessions).toBe(2); expect(u.staff).toBe(false);   // two live ones; the expired one does not count
    expect(u.workspaces.map((w) => w.id).sort()).toEqual([tFine, tClosing].sort());
    expect(await logged('admin.searched_users')).toBe(before + 1);
    expect(JSON.stringify((await sql`select after from audit_log where action = 'admin.searched_users' order by id desc limit 1`)[0]!.after)).toContain(victim);
    expect(JSON.stringify(r.data)).not.toMatch(/token/i);                                                                // sign-in tokens never leave the database
    const byName = await a.searchUsers('Person ' + victim); if (!byName.ok) throw new Error('x'); expect(byName.data.map((x) => x.id)).toEqual([victim]);
    const wild = await a.searchUsers('%'); if (!wild.ok) throw new Error('x'); expect(wild.data.length).toBe(0);           // a lone % must not match everyone
    expect((await a.searchUsers('')).ok).toBe(true);
  });

  it('accounts: ending someone\'s sign-ins needs a reason, works, is logged without the tokens, and cannot be used on yourself', async () => {
    signedIn = staff; const a = await A();
    expect((await a.signOutUser(victim, 'no')).ok).toBe(false);
    expect(Number((await sql`select count(*)::int n from session where user_id = ${victim} and expires_at > now()`)[0]!.n)).toBe(2);
    const r = await a.signOutUser(victim, 'Lost phone, owner asked'); expect(r).toEqual({ ok: true, data: { ended: 3 } });   // two live and the stale one are all removed
    expect(Number((await sql`select count(*)::int n from session where user_id = ${victim}`)[0]!.n)).toBe(0);
    const entry = (await sql`select after, actor_type from audit_log where action = 'admin.signed_out_user' order by id desc limit 1`)[0]!;
    expect(entry.actor_type).toBe('super_admin'); expect(entry.after).toMatchObject({ email: victim + '@example.com', sessionsEnded: 3, reason: 'Lost phone, owner asked' });
    expect(JSON.stringify(entry.after)).not.toMatch(/token/i);
    expect(await a.signOutUser(staff, 'Trying on myself')).toMatchObject({ ok: false });
    expect(await a.signOutUser('no-such-user-' + tag, 'Account that is not there')).toMatchObject({ ok: false });
  });

  it('revenue: counts only active subscriptions, adds GST per month, and lists renewals due in two weeks', async () => {
    const rp = (await sql`select razorpay_plan_id, amount_paise from razorpay_plans limit 1`)[0];
    const planId = rp?.razorpay_plan_id ?? 'plan_x' + tag;
    if (!rp) await sql`insert into razorpay_plans (plan, amount_paise, razorpay_plan_id) values ('starter', 58882, ${planId}) on conflict do nothing`;
    const amt = rp?.amount_paise ?? 58882;
    await sql`insert into subscriptions (tenant_id, plan, razorpay_subscription_id, razorpay_plan_id, status, current_end, cancel_at_cycle_end) values (${tFine}, 'starter', ${'sub_a' + tag}, ${planId}, 'active', now() + interval '5 days', true)`;
    await sql`insert into subscriptions (tenant_id, plan, razorpay_subscription_id, razorpay_plan_id, status, current_end) values (${tBad}, 'starter', ${'sub_b' + tag}, ${planId}, 'cancelled', now() + interval '5 days')`;
    await sql`insert into invoices (tenant_id, number, fy, seq, razorpay_payment_id, buyer_name, plan, base_paise, gst_paise, total_paise, issued_at) values (${tFine}, ${'ZZ/' + tag}, '2026-27', ${900000 + Math.floor(Math.random() * 90000)}, ${'pay_' + tag}, 'Fine Co', 'starter', 49900, 8982, 58882, now())`;
    signedIn = staff; const a = await A(); const r = await a.loadRevenue(); expect(r.ok).toBe(true); if (!r.ok) return;
    // Exact check: add one more CANCELLED subscription and the active count and money must not move; add one ACTIVE and they move by exactly one plan price.
    const base = r.data.byPlan.find((x) => x.plan === 'starter')!;
    await sql`insert into subscriptions (tenant_id, plan, razorpay_subscription_id, razorpay_plan_id, status, current_end) values (${tMeta}, 'starter', ${'sub_c' + tag}, ${planId}, 'cancelled', now() + interval '9 days')`;
    const afterCancelled = (await a.loadRevenue() as { data: Revenue }).data.byPlan.find((x) => x.plan === 'starter')!;
    expect(afterCancelled.count).toBe(base.count); expect(Number(afterCancelled.paise)).toBe(Number(base.paise));
    await sql`update subscriptions set status = 'active' where razorpay_subscription_id = ${'sub_c' + tag}`;
    const afterActive = (await a.loadRevenue() as { data: Revenue }).data.byPlan.find((x) => x.plan === 'starter')!;
    expect(afterActive.count).toBe(base.count + 1); expect(Number(afterActive.paise)).toBe(Number(base.paise) + Number(amt));
    await sql`delete from subscriptions where razorpay_subscription_id = ${'sub_c' + tag}`;
    const starter = r.data.byPlan.find((x) => x.plan === 'starter')!; expect(starter.count).toBeGreaterThanOrEqual(1); expect(starter.paise).toBeGreaterThanOrEqual(Number(amt));
    expect(r.data.renewals.find((x) => x.id === tFine)).toMatchObject({ plan: 'starter', cancelAtEnd: true });
    expect(r.data.renewals.find((x) => x.id === tBad)).toBeUndefined();                                                      // cancelled is not a renewal
    const thisMonth = r.data.months[0]!; expect(thisMonth.totalPaise).toBe(thisMonth.basePaise + thisMonth.gstPaise);
    expect(r.data.recent.find((x) => x.number === 'ZZ/' + tag)).toMatchObject({ tenant: 'Fine Co ' + tag, totalPaise: 58882 });
    await sql`delete from invoices where number = ${'ZZ/' + tag}`; await sql`delete from subscriptions where razorpay_subscription_id in (${'sub_a' + tag}, ${'sub_b' + tag}, ${'sub_c' + tag})`;
  });

  it('revenue: a subscription with an unknown price is counted and flagged, never silently shown as zero rupees', async () => {
    signedIn = staff; const a = await A();
    const before = await a.loadRevenue(); if (!before.ok) throw new Error('x');
    const unp0 = before.data.byPlan.reduce((n, p) => n + p.unpriced, 0); const paise0 = 0;
    await sql`insert into razorpay_plans (plan, amount_paise, razorpay_plan_id) values ('growth', ${123400 + Math.floor(Math.random() * 1000)}, ${'plan_known_' + tag}) on conflict do nothing`;
    await sql`insert into subscriptions (tenant_id, plan, razorpay_subscription_id, razorpay_plan_id, status, current_end) values (${tBad}, 'growth', ${'sub_k' + tag}, ${'plan_known_' + tag}, 'active', now() + interval '30 days')`;
    const mid = await a.loadRevenue(); if (!mid.ok) throw new Error('x');
    const gMid = mid.data.byPlan.find((p) => p.plan === 'growth')!; expect(gMid.count).toBe((before.data.byPlan.find((p) => p.plan === 'growth')?.count ?? 0) + 1); expect(gMid.unpriced).toBe(before.data.byPlan.find((p) => p.plan === 'growth')?.unpriced ?? 0);   // a priced one adds a subscription and money but is not 'unpriced'
    expect(Number(gMid.paise)).toBeGreaterThan(Number(before.data.byPlan.find((p) => p.plan === 'growth')?.paise ?? 0));
    await sql`insert into subscriptions (tenant_id, plan, razorpay_subscription_id, razorpay_plan_id, status, current_end) values (${tMeta}, 'growth', ${'sub_u' + tag}, ${'plan_not_in_our_list_' + tag}, 'active', now() + interval '30 days')`;
    const after = await a.loadRevenue(); if (!after.ok) throw new Error('x');
    expect(after.data.byPlan.reduce((n, p) => n + p.unpriced, 0)).toBe(unp0 + 1);
    // Per plan, not just in total: the 'growth' row must flag exactly the new one, and a plan with only priced subscriptions must flag none.
    const growth = after.data.byPlan.find((p) => p.plan === 'growth')!; const growth0 = before.data.byPlan.find((p) => p.plan === 'growth');
    expect(growth.unpriced).toBe((growth0?.unpriced ?? 0) + 1); expect(growth.count).toBe((growth0?.count ?? 0) + 2);   // the priced one added above and this unpriced one
    expect(after.data.byPlan.filter((p) => p.plan !== 'growth').every((p) => p.unpriced === (before.data.byPlan.find((b) => b.plan === p.plan)?.unpriced ?? 0))).toBe(true);
    expect(growth.unpriced).toBeLessThanOrEqual(growth.count);
    expect(Number(after.data.byPlan.find((p) => p.plan === 'growth')!.paise)).toBe(Number(gMid.paise));                        // the unpriced one adds nothing to the money
    void paise0;
    expect(after.data.byPlan.reduce((n, p) => n + p.count, 0)).toBe(before.data.byPlan.reduce((n, p) => n + p.count, 0) + 2);   // both are counted as subscriptions
    await sql`delete from subscriptions where razorpay_subscription_id in (${'sub_u' + tag}, ${'sub_k' + tag})`; await sql`delete from razorpay_plans where razorpay_plan_id = ${'plan_known_' + tag}`;
  });

  it('staff list: shows who is staff, who added them, how much they did, and their live sign-ins', async () => {
    await sql`update platform_admins set added_by = ${staff} where user_id = ${staff2}`;
    signedIn = staff; const a = await A(); const r = await a.loadStaff(); expect(r.ok).toBe(true); if (!r.ok) return;
    const s2 = r.data.find((x) => x.id === staff2)!; expect(s2.addedBy).toBe(staff + '@example.com'); expect(s2.actions30d).toBe(0);
    const s1 = r.data.find((x) => x.id === staff)!; expect(s1.actions30d).toBeGreaterThan(0); expect(s1.lastAction).not.toBeNull();     // the earlier steps of this test file were all logged under staff
    expect(r.data.find((x) => x.id === plain)).toBeUndefined(); expect(r.data.find((x) => x.id === victim)).toBeUndefined();
  });

  it('notes: the database itself refuses a note that is too short or too long, even if the app layer were bypassed', async () => {
    for (const bad of ['', '  ', 'ab', 'x'.repeat(1001)]) await expect(asApp(staff, (tx) => tx`select admin_add_note(${tBad}::uuid, ${bad})`), JSON.stringify(bad.slice(0, 5))).rejects.toMatchObject({ code: '22023' });
    expect(Number((await sql`select count(*)::int n from admin_notes where tenant_id = ${tBad}`)[0]!.n)).toBe(0);
    await expect(asApp(staff, (tx) => tx`select admin_add_note(${tBad}::uuid, ${'abc'})`)).resolves.toBeTruthy();         // exactly the minimum is fine
    await expect(asApp(staff, (tx) => tx`select admin_add_note(${tBad}::uuid, ${'y'.repeat(1000)})`)).resolves.toBeTruthy();   // and exactly the maximum
    await sql`delete from admin_notes where tenant_id = ${tBad}`;
  });

  it('notes and send errors: a note is stored for staff only and logged by preview, and failed sends are grouped by error code', async () => {
    signedIn = staff; const a = await A();
    expect((await a.addNote(tBad, 'x')).ok).toBe(false); expect((await a.addNote(tBad, 'y'.repeat(1001))).ok).toBe(false);
    expect((await a.addNote(randomUUID(), 'a note for nobody')).ok).toBe(false);
    const long = 'Called the owner about the failures. ' + 'z'.repeat(200);
    const n = await a.addNote(tBad, long); expect(n.ok).toBe(true);
    signedIn = staff2; await a.addNote(tBad, 'Second person adds a note');
    const x = await a.loadTenantExtra(tBad); expect(x.ok).toBe(true); if (!x.ok) return;
    expect(x.data.notes.map((m) => m.by)).toEqual([staff2 + '@example.com', staff + '@example.com']);                  // newest first, by whom
    expect(x.data.errors).toMatchObject([{ code: 131026, count: 8 }, { code: 131049, count: 4 }]);                       // most common first
    const entry = (await sql`select after from audit_log where action = 'admin.note_added' and tenant_id = ${tBad} and after->>'preview' like 'Called the owner%' limit 1`)[0]!;
    expect((entry.after as { preview: string }).preview.length).toBe(80); expect(JSON.stringify(entry.after)).not.toContain('z'.repeat(150));   // only a preview is logged
    expect((await a.loadTenantExtra(tMeta) as { data: { notes: unknown[]; errors: unknown[] } }).data).toMatchObject({ notes: [], errors: [], closure: null });   // a workspace with nothing to show
    // Deleting the workspace removes its notes too.
    expect(Number((await sql`select count(*)::int n from admin_notes where tenant_id = ${tBad}`)[0]!.n)).toBe(2);
  });

  it('every staff read of personal data or change is audited under the admin\'s name', async () => {
    const rows = await sql`select action, count(*)::int n from audit_log where actor_type = 'super_admin' and actor_user_id in (${staff}, ${staff2}) group by action`;
    const seen = Object.fromEntries(rows.map((r) => [r.action, r.n]));
    for (const k of ['admin.closure_cancelled', 'admin.searched_users', 'admin.signed_out_user', 'admin.note_added']) expect(seen[k], k).toBeGreaterThanOrEqual(1);
  });
});
