import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  GraphClient, MetaError, MetaUnknownOutcome, bodyParams, chooseEndpoint, decryptSecret, encryptSecret, explodeWebhook, fromUnixSeconds, isStartText, isStopText,
  nextStatus, parseCallbackData, quickReplyParam, randomPin, rerouteFor, templateMessage, textMessage, urlButtonParam, verifyChallenge, verifySignature, withProductPolicy,
} from '../src';

const SECRET = 'app-secret-for-tests';
const sign = (body: string) => 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');

describe('webhook signature (spec 5.2)', () => {
  it('accepts a correct signature over the raw bytes', () => {
    const body = '{"object":"whatsapp_business_account","entry":[]}';
    expect(verifySignature(Buffer.from(body), sign(body), SECRET)).toBe(true);
  });
  it('rejects a wrong secret, tampered body, missing or malformed header', () => {
    const body = '{"a":1}';
    expect(verifySignature(body, sign(body), 'other')).toBe(false);
    expect(verifySignature('{"a":2}', sign(body), SECRET)).toBe(false);
    expect(verifySignature(body, undefined, SECRET)).toBe(false);
    expect(verifySignature(body, 'sha1=abc', SECRET)).toBe(false);
    expect(verifySignature(body, 'sha256=zz', SECRET)).toBe(false);
    expect(verifySignature(body, sign(body), '')).toBe(false);
  });
  it('must hash the RAW bytes: Meta escapes unicode, so re-serialised JSON would not match', () => {
    const raw = '{"text":"\\u0928\\u092e\\u0938\\u094d\\u0924\\u0947"}'; // escaped, as Meta sends it
    const sig = sign(raw);
    expect(verifySignature(raw, sig, SECRET)).toBe(true);
    expect(verifySignature(JSON.stringify(JSON.parse(raw)), sig, SECRET)).toBe(false);
  });
  it('GET challenge needs the mode, the right token and a challenge', () => {
    expect(verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 't', 'hub.challenge': '123' }, 't')).toEqual({ ok: true, challenge: '123' });
    expect(verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': '123' }, 't').ok).toBe(false);
    expect(verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' }, '').ok).toBe(false);
  });
});

describe('explodeWebhook (spec 5.2 step 3, 5.5)', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA1', changes: [
      { field: 'messages', value: { metadata: { phone_number_id: 'PN1' }, contacts: [{ wa_id: '919876543210', profile: { name: 'Asha' } }], messages: [{ id: 'wamid.A', from: '919876543210', type: 'text', text: { body: 'hi' }, timestamp: '1700000000' }, { id: 'wamid.B', type: 'text', text: { body: 'yo' } }], statuses: [{ id: 'wamid.X', status: 'delivered', timestamp: '1700000001' }] } },
      { field: 'message_template_status_update', value: { event: 'APPROVED', message_template_id: 1, message_template_name: 't' } },
    ] }],
  };
  const items = explodeWebhook(payload);
  it('explodes messages and statuses, and keeps other fields whole', () => {
    expect(items.map((i) => i.kind)).toEqual(['message', 'message', 'status', 'field']);
    expect(items.every((i) => i.wabaId === 'WABA1')).toBe(true);
    expect(items[0]!.phoneNumberId).toBe('PN1');
    expect(items[3]!.field).toBe('message_template_status_update');
  });
  it('dedupe keys are stable, so a replay inserts nothing new', () => {
    expect(explodeWebhook(payload).map((i) => i.dedupeKey)).toEqual(items.map((i) => i.dedupeKey));
    expect(new Set(items.map((i) => i.dedupeKey)).size).toBe(items.length);
  });
  it('the same status id with a different status is a different event', () => {
    const a = explodeWebhook({ entry: [{ id: 'W', changes: [{ field: 'messages', value: { statuses: [{ id: 'x', status: 'sent' }] } }] }] })[0]!;
    const b = explodeWebhook({ entry: [{ id: 'W', changes: [{ field: 'messages', value: { statuses: [{ id: 'x', status: 'read' }] } }] }] })[0]!;
    expect(a.dedupeKey).not.toBe(b.dedupeKey);
  });
  it('never throws on garbage and never loses an event with no id', () => {
    expect(explodeWebhook(null)).toEqual([]);
    expect(explodeWebhook({ entry: 'x' })).toEqual([]);
    expect(explodeWebhook({ entry: [{ changes: [{ field: 'messages', value: { messages: [{ type: 'text' }] } }] }] })).toHaveLength(1);
  });
});

describe('status ordering (spec 5.4)', () => {
  it('never downgrades; failed is terminal', () => {
    expect(nextStatus('delivered', 'sent')).toBe('delivered');
    expect(nextStatus('sent', 'read')).toBe('read');
    expect(nextStatus('read', 'delivered')).toBe('read');
    expect(nextStatus('sent', 'failed')).toBe('failed');
    expect(nextStatus('failed', 'read')).toBe('failed');
  });
  it('parses Unix-second strings and callback data', () => {
    expect(fromUnixSeconds('1700000000')?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
    expect(fromUnixSeconds('x')).toBeNull();
    expect(parseCallbackData('msg:123e4567-e89b-12d3-a456-426614174000')).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(parseCallbackData('other')).toBeNull();
  });
  it('detects STOP and START in English and Hinglish', () => {
    for (const t of ['STOP', ' stop. ', 'Unsubscribe', 'band karo', 'बंद करो']) expect(isStopText(t)).toBe(true);
    for (const t of ['please stop sending', 'stopwatch', 'ok']) expect(isStopText(t)).toBe(false);
    expect(isStartText('START')).toBe(true);
  });
});

describe('payload builders and routing (spec 4.1 to 4.3)', () => {
  it('template message has the documented envelope and an idempotent callback id', () => {
    const m = templateMessage({ to: '+919876543210', name: 'renewal', language: 'en', components: [bodyParams(['Asha', '30 Nov'])], messageId: '123e4567-e89b-12d3-a456-426614174000' });
    expect(m).toMatchObject({ messaging_product: 'whatsapp', recipient_type: 'individual', to: '+919876543210', type: 'template', biz_opaque_callback_data: 'msg:123e4567-e89b-12d3-a456-426614174000' });
    expect(m.template).toEqual({ name: 'renewal', language: { code: 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Asha' }, { type: 'text', text: '30 Nov' }] }] });
  });
  it('named parameters include parameter_name, positional do not', () => {
    expect(bodyParams(['Asha'], ['first_name']).parameters[0]).toEqual({ type: 'text', text: 'Asha', parameter_name: 'first_name' });
    expect(bodyParams(['Asha']).parameters[0]).toEqual({ type: 'text', text: 'Asha' });
  });
  it('URL button values are percent-encoded; quick replies carry a payload', () => {
    expect(urlButtonParam(0, 'abc 123')).toEqual({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'abc%20123' }] });
    expect(quickReplyParam(2, 'STOP:c_456').parameters[0]).toEqual({ type: 'payload', payload: 'STOP:c_456' });
  });
  it('refuses a recipient that is not E.164 instead of letting Meta guess the country', () => {
    for (const bad of ['9876543210', '09876543210', '+0123', 'abc', '']) expect(() => templateMessage({ to: bad, name: 'x', language: 'en' })).toThrow(/E\.164/);
  });
  it('text messages are limited to 4096 characters and cannot be empty', () => {
    expect(() => textMessage({ to: '+919876543210', body: '   ' })).toThrow();
    expect(() => textMessage({ to: '+919876543210', body: 'a'.repeat(4097) })).toThrow();
    expect(textMessage({ to: '+919876543210', body: 'hi' }).text.body).toBe('hi');
  });
  it('marketing templates go to /marketing_messages with the fallback policy; others to /messages', () => {
    expect(chooseEndpoint({ type: 'template', categoryCurrent: 'MARKETING', now: new Date('2026-12-01') })).toEqual({ endpoint: 'marketing_messages', productPolicy: 'CLOUD_API_FALLBACK' });
    expect(chooseEndpoint({ type: 'template', categoryCurrent: 'UTILITY' })).toEqual({ endpoint: 'messages' });
    expect(chooseEndpoint({ type: 'text' })).toEqual({ endpoint: 'messages' });
  });
  it('strict policy when chosen, and automatically from 2027-10-13', () => {
    expect(chooseEndpoint({ type: 'template', categoryCurrent: 'MARKETING', sendPolicy: 'mm_strict', now: new Date('2026-12-01') }).productPolicy).toBe('STRICT');
    expect(chooseEndpoint({ type: 'template', categoryCurrent: 'MARKETING', now: new Date('2027-10-13T00:00:01Z') }).productPolicy).toBe('STRICT');
    expect(withProductPolicy({ a: 1 }, 'STRICT')).toEqual({ a: 1, product_policy: 'STRICT' });
  });
  it('re-routes on 131063 to marketing and on 131055 / 134100 to messages', () => {
    expect(rerouteFor(131063)).toBe('marketing_messages');
    expect(rerouteFor(131055)).toBe('messages');
    expect(rerouteFor(134100)).toBe('messages');
    expect(rerouteFor(131047)).toBeNull();
  });
});

describe('token encryption (AGENTS.md rule 7)', () => {
  const key = randomBytes(32).toString('base64');
  it('round-trips and never stores plaintext', () => {
    const blob = encryptSecret('EAAJB-secret-token', key);
    expect(blob.startsWith('v1.')).toBe(true);
    expect(blob).not.toContain('EAAJB');
    expect(decryptSecret(blob, key)).toBe('EAAJB-secret-token');
  });
  it('uses a fresh IV each time', () => { expect(encryptSecret('x', key)).not.toBe(encryptSecret('x', key)); });
  it('fails on a wrong key or a tampered value', () => {
    const blob = encryptSecret('tok', key);
    expect(() => decryptSecret(blob, randomBytes(32).toString('base64'))).toThrow();
    const parts = blob.split('.'); parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
  });
  it('rejects a key of the wrong length', () => { expect(() => encryptSecret('x', 'short')).toThrow(/32 bytes/); });
  it('PIN is 6 digits', () => { for (let i = 0; i < 50; i++) expect(randomPin()).toMatch(/^\d{6}$/); });
});

describe('GraphClient (fake fetch)', () => {
  const mk = (impl: typeof fetch) => new GraphClient({ graphVersion: 'v26.0', appId: 'APP', appSecret: 'SEC', fetchImpl: impl });
  const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('pins the version from config and puts the token in the Authorization header only', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const c = mk((async (url: string, init: RequestInit) => { seen = { url, init }; return new Response('{"messages":[{"id":"wamid.1"}]}'); }) as unknown as typeof fetch);
    await c.sendMessage('PN1', 'TOKEN123', { a: 1 });
    expect(seen!.url).toBe('https://graph.facebook.com/v26.0/PN1/messages');
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN123');
    expect(seen!.url).not.toContain('TOKEN123');
  });
  it('marketing sends use /marketing_messages', async () => {
    let u = '';
    await mk((async (url: string) => { u = url; return new Response('{}'); }) as unknown as typeof fetch).sendMarketingMessage('PN1', 't', {});
    expect(u.endsWith('/PN1/marketing_messages')).toBe(true);
  });
  it('turns a Graph error into MetaError with the policy for its code', async () => {
    const c = mk(ok({ error: { message: 'Re-engagement message', code: 131047, fbtrace_id: 'x' } }, 400));
    const e = await c.sendMessage('PN1', 't', {}).catch((x) => x);
    expect(e).toBeInstanceOf(MetaError);
    expect(e.code).toBe(131047);
    expect(e.policy.action).toBe('suggest_template');
  });
  it('an unknown code is flagged, not guessed', async () => {
    const e = await mk(ok({ error: { code: 777777 } }, 400)).sendMessage('PN1', 't', {}).catch((x) => x);
    expect(e.policy.known).toBe(false);
    expect(e.policy.action).toBe('dlq');
  });
  it('a network failure or a bodyless 5xx is an UNKNOWN outcome: never blindly re-sent (spec 4.5 step 6)', async () => {
    const boom = mk((async () => { throw new Error('socket hang up'); }) as unknown as typeof fetch);
    expect(await boom.sendMarketingMessage('PN1', 't', {}).catch((x) => x)).toBeInstanceOf(MetaUnknownOutcome);
    const five = mk((async () => new Response('Bad gateway', { status: 502 })) as unknown as typeof fetch);
    expect(await five.sendMessage('PN1', 't', {}).catch((x) => x)).toBeInstanceOf(MetaUnknownOutcome);
  });
  it('a 5xx WITH a Graph error body is a normal MetaError', async () => {
    const e = await mk(ok({ error: { code: 2, is_transient: true } }, 500)).sendMessage('PN1', 't', {}).catch((x) => x);
    expect(e).toBeInstanceOf(MetaError);
    expect(e.isTransient).toBe(true);
  });
  it('code exchange sends the app secret in the query, server-side, and requires it', async () => {
    let u = '';
    const c = mk((async (url: string) => { u = url; return new Response('{"access_token":"BT"}'); }) as unknown as typeof fetch);
    expect((await c.exchangeCode('CODE')).access_token).toBe('BT');
    expect(u).toContain('client_secret=SEC');
    await expect(new GraphClient({ graphVersion: 'v26.0', fetchImpl: ok({}) }).exchangeCode('x')).rejects.toThrow(/META_APP_ID/);
  });
  it('rejects a malformed version', () => { expect(() => new GraphClient({ graphVersion: '26' })).toThrow(); });
});
