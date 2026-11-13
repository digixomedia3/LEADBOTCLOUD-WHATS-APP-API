import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * The only place that talks to Razorpay (same rule as @lbc/meta for Meta). Keys are passed per call and never logged.
 * Everything here was written from Razorpay's published docs: Basic auth with key_id:key_secret, amounts in paise,
 * webhook signature = HMAC-SHA256 hex of the RAW body with the webhook secret, in the X-Razorpay-Signature header.
 */
export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  /** Test/mocking hook only. Production leaves this unset. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class RazorpayError extends Error {
  constructor(public readonly status: number, public readonly code: string | undefined, message: string, public readonly path: string) {
    super(message);
    this.name = 'RazorpayError';
  }
  /** 4xx other than rate limiting will not get better by retrying. */
  get retryable() { return this.status === 429 || this.status >= 500; }
}

export const RazorpaySubscription = z.object({
  id: z.string(),
  plan_id: z.string(),
  customer_id: z.string().nullish(),
  status: z.string(),
  current_start: z.number().nullish(),
  current_end: z.number().nullish(),
  paid_count: z.number().nullish(),
  remaining_count: z.number().nullish(),
  short_url: z.string().nullish(),
  has_scheduled_changes: z.boolean().nullish(),
  notes: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).nullish(),
}).passthrough();
export type RazorpaySubscription = z.infer<typeof RazorpaySubscription>;

const PlanResp = z.object({ id: z.string() }).passthrough();

export class RazorpayClient {
  constructor(private readonly cfg: RazorpayConfig) {
    if (!cfg.keyId || !cfg.keySecret) throw new Error('Razorpay key id and secret are required');
  }

  private async call<T>(method: string, path: string, body: unknown, parse: (j: unknown) => T): Promise<T> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.cfg.timeoutMs ?? 15_000);
    let res: Response;
    try {
      res = await (this.cfg.fetchImpl ?? fetch)(`${this.cfg.baseUrl ?? 'https://api.razorpay.com'}${path}`, {
        method,
        headers: { authorization: `Basic ${Buffer.from(`${this.cfg.keyId}:${this.cfg.keySecret}`).toString('base64')}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl.signal,
      });
    } catch (e) {
      throw new RazorpayError(0, 'NETWORK', `Razorpay request failed: ${(e as Error).name}`, path);
    } finally { clearTimeout(t); }
    const text = await res.text();
    let json: unknown; try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
    if (!res.ok) {
      const err = (json as { error?: { code?: string; description?: string } }).error;
      throw new RazorpayError(res.status, err?.code, err?.description ?? `Razorpay HTTP ${res.status}`, path);
    }
    return parse(json);
  }

  /** Creates a monthly plan. amountPaise is the GST-inclusive total the customer is charged each month. */
  createPlan(a: { name: string; amountPaise: number; notes?: Record<string, string> }) {
    return this.call('POST', '/v1/plans', {
      period: 'monthly', interval: 1,
      item: { name: a.name, amount: a.amountPaise, currency: 'INR', description: a.name },
      notes: a.notes ?? {},
    }, (j) => PlanResp.parse(j).id);
  }

  /** total_count is the number of billing cycles; Razorpay requires one, so use a long horizon and rely on cancel to stop it. */
  createSubscription(a: { planId: string; totalCount?: number; notes?: Record<string, string> }) {
    return this.call('POST', '/v1/subscriptions', {
      plan_id: a.planId, total_count: a.totalCount ?? 120, quantity: 1, customer_notify: true, notes: a.notes ?? {},
    }, (j) => RazorpaySubscription.parse(j));
  }

  fetchSubscription(id: string) { return this.call('GET', `/v1/subscriptions/${encodeURIComponent(id)}`, undefined, (j) => RazorpaySubscription.parse(j)); }

  /** atCycleEnd=true keeps access until the paid period ends (what the refund policy promises). */
  cancelSubscription(id: string, atCycleEnd: boolean) {
    return this.call('POST', `/v1/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 }, (j) => RazorpaySubscription.parse(j));
  }

  /** Moves the subscription to another plan. 'cycle_end' applies it at the next renewal; 'now' applies it immediately. */
  changePlan(id: string, planId: string, when: 'now' | 'cycle_end') {
    return this.call('PATCH', `/v1/subscriptions/${encodeURIComponent(id)}`, { plan_id: planId, schedule_change_at: when, customer_notify: true }, (j) => RazorpaySubscription.parse(j));
  }
}

/** Constant-time check of X-Razorpay-Signature against the raw request body. Wrong length or non-hex is simply "not valid". */
export function verifyWebhookSignature(rawBody: string | Buffer, signature: string | null | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8'), b = Buffer.from(signature.trim(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

const Entity = <T extends z.ZodTypeAny>(s: T) => z.object({ entity: s });
export const BillingEvent = z.object({
  event: z.string(),
  created_at: z.number().nullish(),
  payload: z.object({
    subscription: Entity(RazorpaySubscription).optional(),
    payment: Entity(z.object({
      id: z.string(), amount: z.number(), currency: z.string().nullish(), status: z.string().nullish(), invoice_id: z.string().nullish(), method: z.string().nullish(),
    }).passthrough()).optional(),
  }).passthrough(),
}).passthrough();
export type BillingEvent = z.infer<typeof BillingEvent>;

/** Events that change what a workspace is entitled to. Anything else is stored for the record and acknowledged. */
export const HANDLED_EVENTS = new Set([
  'subscription.authenticated', 'subscription.activated', 'subscription.charged', 'subscription.pending', 'subscription.halted',
  'subscription.cancelled', 'subscription.completed', 'subscription.paused', 'subscription.resumed', 'subscription.updated',
]);

/** Razorpay retries with the same event id header; fall back to a stable hash of the body when it is absent. */
export function dedupeKey(eventIdHeader: string | null | undefined, rawBody: string): string {
  return eventIdHeader?.trim() ? `id:${eventIdHeader.trim()}` : `sha:${createHmac('sha256', 'dedupe').update(rawBody).digest('hex')}`;
}
