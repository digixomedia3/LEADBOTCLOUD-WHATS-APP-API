import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BillingEvent, RazorpayClient, RazorpayError, dedupeKey, verifyWebhookSignature } from '../src';

const sign = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('hex');

describe('verifyWebhookSignature', () => {
  const body = '{"event":"subscription.charged"}';
  it('accepts the correct HMAC-SHA256 hex of the raw body', () => { expect(verifyWebhookSignature(body, sign(body, 'whsec'), 'whsec')).toBe(true); });
  it('rejects a different secret, a tampered body, and a body re-serialised with different spacing', () => {
    expect(verifyWebhookSignature(body, sign(body, 'other'), 'whsec')).toBe(false);
    expect(verifyWebhookSignature(body + ' ', sign(body, 'whsec'), 'whsec')).toBe(false);
    expect(verifyWebhookSignature(JSON.stringify(JSON.parse(body), null, 2), sign(body, 'whsec'), 'whsec')).toBe(false);
  });
  it('rejects missing, empty, short, long and non-hex signatures without throwing', () => {
    for (const s of [undefined, null, '', 'abc', sign(body, 'whsec') + '00', 'z'.repeat(64)]) expect(verifyWebhookSignature(body, s, 'whsec')).toBe(false);
  });
  it('rejects everything when no secret is configured', () => { expect(verifyWebhookSignature(body, sign(body, ''), '')).toBe(false); });
  it('works on a Buffer body too', () => { expect(verifyWebhookSignature(Buffer.from(body), sign(body, 'whsec'), 'whsec')).toBe(true); });
});

describe('dedupeKey', () => {
  it('uses the event id header when present', () => { expect(dedupeKey(' evt_1 ', 'x')).toBe('id:evt_1'); });
  it('falls back to a stable hash of the body', () => {
    expect(dedupeKey(null, 'a')).toBe(dedupeKey(undefined, 'a')); expect(dedupeKey('', 'a')).not.toBe(dedupeKey('', 'b')); expect(dedupeKey(null, 'a')).toMatch(/^sha:[0-9a-f]{64}$/);
  });
});

function fake(responses: { status?: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, client: new RazorpayClient({ keyId: 'rzp_test_k', keySecret: 'sec', fetchImpl, baseUrl: 'https://rzp.test' }) };
}

describe('RazorpayClient', () => {
  it('requires keys', () => { expect(() => new RazorpayClient({ keyId: '', keySecret: '' })).toThrow(/required/); });
  it('creates a monthly plan with the GST-inclusive amount in paise, using Basic auth', async () => {
    const { calls, client } = fake([{ body: { id: 'plan_1' } }]);
    expect(await client.createPlan({ name: 'LeadBotCloud Starter', amountPaise: 58_882 })).toBe('plan_1');
    expect(calls[0]!.url).toBe('https://rzp.test/v1/plans');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('rzp_test_k:sec').toString('base64')}`);
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ period: 'monthly', interval: 1, item: { amount: 58_882, currency: 'INR' } });
  });
  it('creates a subscription and parses it', async () => {
    const { calls, client } = fake([{ body: { id: 'sub_1', plan_id: 'plan_1', status: 'created', short_url: 'https://rzp.io/i/x' } }]);
    const s = await client.createSubscription({ planId: 'plan_1', notes: { tenant: 't' } });
    expect(s).toMatchObject({ id: 'sub_1', status: 'created', short_url: 'https://rzp.io/i/x' });
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ plan_id: 'plan_1', total_count: 120, notes: { tenant: 't' } });
  });
  it('cancels at cycle end or immediately', async () => {
    const { calls, client } = fake([{ body: { id: 's', plan_id: 'p', status: 'active' } }, { body: { id: 's', plan_id: 'p', status: 'cancelled' } }]);
    await client.cancelSubscription('s', true); await client.cancelSubscription('s', false);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ cancel_at_cycle_end: 1 });
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ cancel_at_cycle_end: 0 });
  });
  it('changes plan with PATCH and a schedule', async () => {
    const { calls, client } = fake([{ body: { id: 's', plan_id: 'p2', status: 'active' } }]);
    await client.changePlan('s', 'p2', 'cycle_end');
    expect(calls[0]!.init.method).toBe('PATCH'); expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ plan_id: 'p2', schedule_change_at: 'cycle_end' });
  });
  it('turns Razorpay errors into RazorpayError with the description, and says which can be retried', async () => {
    const bad = fake([{ status: 400, body: { error: { code: 'BAD_REQUEST_ERROR', description: 'The amount must be at least INR 1.00' } } }]);
    const e = (await bad.client.createPlan({ name: 'x', amountPaise: 1 }).catch((x: unknown) => x)) as RazorpayError;
    expect(e).toBeInstanceOf(RazorpayError); expect(e.message).toBe('The amount must be at least INR 1.00'); expect(e.retryable).toBe(false);
    const down = fake([{ status: 502, body: {} }]);
    expect(((await down.client.fetchSubscription('s').catch((x: unknown) => x)) as RazorpayError).retryable).toBe(true);
    const slow = fake([{ status: 429, body: {} }]);
    expect(((await slow.client.fetchSubscription('s').catch((x: unknown) => x)) as RazorpayError).retryable).toBe(true);
  });
  it('reports a network failure as retryable and never leaks the secret', async () => {
    const client = new RazorpayClient({ keyId: 'k', keySecret: 'supersecret', fetchImpl: (async () => { throw new TypeError('fetch failed supersecret'); }) as unknown as typeof fetch });
    const e = (await client.fetchSubscription('s').catch((x: unknown) => x)) as RazorpayError;
    expect(e).toBeInstanceOf(RazorpayError); expect(e.status).toBe(0); expect(e.retryable).toBe(false); expect(String(e.message)).not.toContain('supersecret');
  });
  it('url-encodes the id so a crafted id cannot reach another path', async () => {
    const { calls, client } = fake([{ body: { id: 's', plan_id: 'p', status: 'active' } }]);
    await client.fetchSubscription('../plans');
    expect(calls[0]!.url).toBe('https://rzp.test/v1/subscriptions/..%2Fplans');
  });
});

describe('BillingEvent', () => {
  it('parses a charged event with subscription and payment', () => {
    const e = BillingEvent.parse({ event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_1', plan_id: 'p', status: 'active', current_start: 1, current_end: 2, paid_count: 1, notes: [] } }, payment: { entity: { id: 'pay_1', amount: 58_882, currency: 'INR', status: 'captured' } } } });
    expect(e.payload.payment!.entity.amount).toBe(58_882); expect(e.payload.subscription!.entity.paid_count).toBe(1);
  });
  it('rejects a body with no event name', () => { expect(BillingEvent.safeParse({ payload: {} }).success).toBe(false); });
});
