/**
 * Plan prices and GST maths (spec A4.13). Money is integer paise. The Razorpay plan amount is the GST-INCLUSIVE total, so what the customer
 * sees on the pricing page (ex-GST) plus 18% is exactly what the card is charged, and every invoice splits it back into base and tax.
 * Prices live in code so they are testable; change them here and the Razorpay plan is re-created on the next checkout.
 */
import type { PlanId } from './plans';

export const GST_RATE_PCT = 18;
export type PaidPlanId = Exclude<PlanId, 'free'>;
export type Cycle = 'monthly';

/** Ex-GST monthly price in paise. */
export const PLAN_PRICE_PAISE: Record<PaidPlanId, number> = { starter: 49_900, growth: 129_900, pro: 299_900 };

export const isPaidPlan = (p: string): p is PaidPlanId => p in PLAN_PRICE_PAISE;
export const planRank = (p: string): number => ['free', 'starter', 'growth', 'pro'].indexOf(p);

/** Splits an ex-GST price into what is charged. Rounds the tax to the nearest paisa, never the base. */
export function priceWithGst(basePaise: number) {
  const gst = Math.round((basePaise * GST_RATE_PCT) / 100);
  return { basePaise, gstPaise: gst, totalPaise: basePaise + gst };
}

/** Splits a GST-inclusive total back into base and tax (for invoices built from what Razorpay reports it charged). */
export function splitInclusive(totalPaise: number) {
  const base = Math.round((totalPaise * 100) / (100 + GST_RATE_PCT));
  return { basePaise: base, gstPaise: totalPaise - base, totalPaise };
}

export const planCharge = (p: PaidPlanId) => priceWithGst(PLAN_PRICE_PAISE[p]);

/**
 * Indian financial year label for an invoice number: April to March. 2026-11-13 -> "2026-27", 2027-02-01 -> "2026-27".
 * Computed in India time, because an invoice dated 1 April 00:30 IST is still 31 March in UTC.
 */
export function financialYear(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 3_600_000);
  const y = ist.getUTCFullYear(), m = ist.getUTCMonth() + 1;
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export const invoiceNumber = (fy: string, seq: number) => `LBC/${fy}/${String(seq).padStart(6, '0')}`;

/** What a workspace is allowed once its paid period is over. Data is never deleted on downgrade; only new additions are limited. */
export function overLimits(plan: string, usage: { contacts: number; users: number }, limits: { contacts: number; users: number }) {
  return { contacts: usage.contacts > limits.contacts, users: usage.users > limits.users, any: usage.contacts > limits.contacts || usage.users > limits.users };
}
