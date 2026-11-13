'use server';

import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { RazorpayClient, RazorpayError } from '@lbc/razorpay';
import { PLAN_LIMITS, isPaidPlan, planCharge, planRank, type PaidPlanId } from '@lbc/shared';
import { Forbidden, assertRole, db, requireCtx, type Ctx } from '@/lib/session';

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Keys come from the environment only. RAZORPAY_BASE_URL exists so tests can point at a local fake; production leaves it unset. */
function client(): RazorpayClient | null {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim(), keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) return null;
  return new RazorpayClient({ keyId, keySecret, baseUrl: process.env.RAZORPAY_BASE_URL || undefined });
}
const NOT_ON = 'Online payment is not switched on yet. Please try again soon or contact support.';
const friendly = (e: unknown) => e instanceof RazorpayError ? (e.retryable ? 'Razorpay is not responding right now. Nothing was charged. Please try again in a minute.' : `Razorpay could not do that: ${e.message}`) : 'Something went wrong. Nothing was charged.';

async function ownerCtx(): Promise<{ ctx: Ctx } | { error: string }> {
  const ctx = await requireCtx();
  try { assertRole(ctx, 'owner'); } catch (e) { if (e instanceof Forbidden) return { error: 'Only the workspace owner can change billing.' }; throw e; }
  return { ctx };
}

export interface BillingInfo {
  enabled: boolean;
  plan: string;
  isOwner: boolean;
  sub: { plan: string; status: string; currentEnd: string | null; cancelAtCycleEnd: boolean; pendingPlan: string | null; paidCount: number } | null;
  invoices: { id: string; number: string; plan: string; totalPaise: number; issuedAt: string }[];
  usage: { contacts: number; users: number };
  limits: { contacts: number; users: number };
}

interface SubRow { plan: string; status: string; current_end: string | null; cancel_at_cycle_end: boolean; pending_plan: string | null; paid_count: number }
interface InvRow { id: string; number: string; plan: string; total_paise: number; issued_at: string }
interface SubIds { razorpay_subscription_id: string; plan: string; status: string }
export async function loadBilling(): Promise<BillingInfo> {
  const ctx = await requireCtx();
  const limits = PLAN_LIMITS[ctx.workspace.plan as 'free'] ?? PLAN_LIMITS.free;
  return db(ctx, async (tx) => {
    const s = ((await tx.execute(sql`select plan, status, current_end, cancel_at_cycle_end, pending_plan, paid_count from subscriptions`)) as unknown as SubRow[])[0];
    const inv = (await tx.execute(sql`select id, number, plan, total_paise, issued_at from invoices order by issued_at desc limit 24`)) as unknown as InvRow[];
    const c = Number(((await tx.execute(sql`select count(*)::int as n from contacts`)) as unknown as { n: number }[])[0]!.n);
    const u = Number(((await tx.execute(sql`select count(*)::int as n from tenant_members`)) as unknown as { n: number }[])[0]!.n);
    return {
      enabled: client() !== null, plan: ctx.workspace.plan, isOwner: ctx.role === 'owner',
      sub: s ? { plan: s.plan, status: s.status, currentEnd: s.current_end ? new Date(s.current_end).toISOString() : null, cancelAtCycleEnd: s.cancel_at_cycle_end, pendingPlan: s.pending_plan, paidCount: s.paid_count } : null,
      invoices: inv.map((i) => ({ id: i.id, number: i.number, plan: i.plan, totalPaise: i.total_paise, issuedAt: new Date(i.issued_at).toISOString() })),
      usage: { contacts: c, users: u }, limits: { contacts: limits.contacts, users: limits.users },
    };
  });
}

/** The Razorpay plan for this exact price. Created on first use and remembered, so a price change makes a new plan and never edits an old one. */
async function razorpayPlanFor(ctx: Ctx, rzp: RazorpayClient, plan: PaidPlanId): Promise<string> {
  const amount = planCharge(plan).totalPaise;
  const find = async () => ((await db(ctx, (tx) => tx.execute(sql`select razorpay_plan_id from razorpay_plans where plan = ${plan} and amount_paise = ${amount}`))) as unknown as { razorpay_plan_id: string }[])[0]?.razorpay_plan_id;
  const have = await find(); if (have) return have;
  const id = await rzp.createPlan({ name: `LeadBotCloud ${PLAN_LIMITS[plan].label} (incl. 18% GST)`, amountPaise: amount, notes: { plan } });
  await db(ctx, (tx) => tx.execute(sql`insert into razorpay_plans (plan, amount_paise, razorpay_plan_id) values (${plan}, ${amount}, ${id}) on conflict do nothing`));
  return (await find()) ?? id;
}

/** Starts a subscription and returns Razorpay's hosted payment page. The plan is NOT granted here; only the signed webhook grants it. */
export async function startCheckout(plan: string): Promise<Result<{ url: string }>> {
  const g = await ownerCtx(); if ('error' in g) return fail(g.error);
  if (!isPaidPlan(plan)) return fail('Choose a paid plan.');
  const rzp = client(); if (!rzp) return fail(NOT_ON);
  const ctx = g.ctx;
  if (ctx.workspace.plan !== 'free') return fail('You already have a paid plan. Use "Change plan" instead.');
  try {
    const planId = await razorpayPlanFor(ctx, rzp, plan);
    const sub = await rzp.createSubscription({ planId, notes: { workspace: ctx.tenantId, plan } });
    if (!sub.short_url) return fail('Razorpay did not return a payment link. Nothing was charged. Please try again.');
    try {
      await db(ctx, (tx) => tx.execute(sql`select public.begin_checkout(${plan}, ${sub.id}, ${planId}, ${sub.short_url})`));
    } catch (e) {
      if (/subscription_live/.test((e as Error).message)) { await rzp.cancelSubscription(sub.id, false).catch(() => undefined); return fail('You already have an active subscription.'); }
      throw e;
    }
    revalidatePath('/settings');
    return { ok: true, data: { url: sub.short_url } };
  } catch (e) { return fail(friendly(e)); }
}

/** Upgrades apply now; downgrades wait for the end of the paid period (the refund policy promises no mid-cycle refunds). */
export async function changePlan(plan: string): Promise<Result<{ when: 'now' | 'cycle_end' }>> {
  const g = await ownerCtx(); if ('error' in g) return fail(g.error);
  if (!isPaidPlan(plan)) return fail('Choose a paid plan.');
  const rzp = client(); if (!rzp) return fail(NOT_ON);
  const ctx = g.ctx;
  const s = ((await db(ctx, (tx) => tx.execute(sql`select razorpay_subscription_id, plan, status from subscriptions`))) as unknown as SubIds[])[0];
  if (!s || s.status !== 'active') return fail('You need an active subscription to change plan.');
  if (s.plan === plan) return fail('You are already on this plan.');
  const when = planRank(plan) > planRank(s.plan) ? 'now' : 'cycle_end';
  try {
    const planId = await razorpayPlanFor(ctx, rzp, plan);
    await rzp.changePlan(s.razorpay_subscription_id, planId, when);
    await db(ctx, (tx) => tx.execute(sql`select public.note_billing_change(false, ${when === 'cycle_end' ? plan : null})`));
    revalidatePath('/settings');
    return { ok: true, data: { when } };
  } catch (e) { return fail(friendly(e)); }
}

/** Cancels at the end of the paid period. The workspace keeps its plan until then, then drops to Free; no data is deleted. */
export async function cancelSubscription(): Promise<Result> {
  const g = await ownerCtx(); if ('error' in g) return fail(g.error);
  const rzp = client(); if (!rzp) return fail(NOT_ON);
  const ctx = g.ctx;
  const s = ((await db(ctx, (tx) => tx.execute(sql`select razorpay_subscription_id, plan, status from subscriptions`))) as unknown as SubIds[])[0];
  if (!s || s.status !== 'active') return fail('There is no active subscription to cancel.');
  try {
    await rzp.cancelSubscription(s.razorpay_subscription_id, true);
    await db(ctx, (tx) => tx.execute(sql`select public.note_billing_change(true, null)`));
    revalidatePath('/settings');
    return { ok: true, data: null };
  } catch (e) { return fail(friendly(e)); }
}

/** Undo a scheduled cancellation is not offered by Razorpay's cancel-at-cycle-end; the owner starts a new subscription after the period ends. */
