import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ConnectorError, GoogleClient, MetaLeadsClient, ShopifyClient, cleanShop, freshGoogleToken, hashState, metaLeadToPayload, needsRefresh, newPkce, newState,
  parseLeadgenWebhook, shopifyToPayload, toTokenSet, verifyShopifyQuery, verifyShopifyWebhook,
} from '../src';

type Call = { url: string; init: RequestInit };
function fake(responses: { status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url: String(url), init }); const r = responses.shift() ?? { body: {} }; return new Response(JSON.stringify(r.body), { status: r.status ?? 200 }); }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const bodyOf = (c: Call) => String(c.init.body ?? '');

describe('state and PKCE', () => {
  it('states are unguessable, unique, and only their hash is stored', () => {
    const a = newState(), b = newState(); expect(a).not.toBe(b); expect(a.length).toBeGreaterThanOrEqual(32);
    expect(hashState(a)).toMatch(/^[0-9a-f]{64}$/); expect(hashState(a)).not.toContain(a);
  });
  it('PKCE challenge is the S256 hash of the verifier', () => {
    const p = newPkce(); expect(p.challenge).toBe(require('node:crypto').createHash('sha256').update(p.verifier).digest('base64url')); expect(p.verifier.length).toBeGreaterThanOrEqual(43);
  });
});

describe('token responses', () => {
  it('reads access, refresh, scopes and expiry', () => {
    const t = toTokenSet({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'one two,three' }, 1_000_000);
    expect(t).toMatchObject({ accessToken: 'a', refreshToken: 'r', scopes: ['one', 'two', 'three'] }); expect(t.expiresAt!.getTime()).toBe(1_000_000 + 3_600_000);
  });
  it('a token without expiry never expires; a response without an access token is an error', () => {
    expect(toTokenSet({ access_token: 'a' }).expiresAt).toBeNull(); expect(() => toTokenSet({})).toThrow(ConnectorError);
  });
  it('refreshes two minutes early, never when there is no expiry', () => {
    expect(needsRefresh(null)).toBe(false); expect(needsRefresh(new Date(Date.now() + 10 * 60_000))).toBe(false); expect(needsRefresh(new Date(Date.now() + 60_000))).toBe(true); expect(needsRefresh(new Date(Date.now() - 1))).toBe(true);
  });
});

describe('Shopify request and webhook signatures', () => {
  const secret = 'shpss_secret';
  const sign = (qs: string) => createHmac('sha256', secret).update(qs).digest('hex');
  it('verifies a callback: hmac removed, remaining keys sorted', () => {
    const hmac = sign('code=abc&shop=x.myshopify.com&state=s1&timestamp=1337178173');
    expect(verifyShopifyQuery(new URLSearchParams(`state=s1&timestamp=1337178173&shop=x.myshopify.com&code=abc&hmac=${hmac}`), secret)).toBe(true);
  });
  it('rejects a changed value, a wrong secret, a missing hmac and an added parameter', () => {
    const hmac = sign('code=abc&shop=x.myshopify.com&state=s1&timestamp=1');
    expect(verifyShopifyQuery(new URLSearchParams(`code=abc&shop=evil.myshopify.com&state=s1&timestamp=1&hmac=${hmac}`), secret)).toBe(false);
    expect(verifyShopifyQuery(new URLSearchParams(`code=abc&shop=x.myshopify.com&state=s1&timestamp=1&hmac=${hmac}`), 'other')).toBe(false);
    expect(verifyShopifyQuery(new URLSearchParams('code=abc&shop=x.myshopify.com&state=s1&timestamp=1'), secret)).toBe(false);
    expect(verifyShopifyQuery(new URLSearchParams(`code=abc&shop=x.myshopify.com&state=s1&timestamp=1&extra=1&hmac=${hmac}`), secret)).toBe(false);
  });
  it('webhooks use base64 (not hex) over the raw body', () => {
    const body = '{"id":1}'; const sig = createHmac('sha256', secret).update(body).digest('base64');
    expect(verifyShopifyWebhook(body, sig, secret)).toBe(true); expect(verifyShopifyWebhook(Buffer.from(body), sig, secret)).toBe(true);
    expect(verifyShopifyWebhook(body, createHmac('sha256', secret).update(body).digest('hex'), secret)).toBe(false);
    expect(verifyShopifyWebhook(body + ' ', sig, secret)).toBe(false); expect(verifyShopifyWebhook(body, undefined, secret)).toBe(false); expect(verifyShopifyWebhook(body, sig, '')).toBe(false);
  });
  it('only real myshopify.com hostnames are accepted (no requests to arbitrary servers)', () => {
    expect(cleanShop('My-Store')).toBe('my-store.myshopify.com'); expect(cleanShop('https://my-store.myshopify.com/admin')).toBe('my-store.myshopify.com');
    for (const bad of ['evil.com', 'a.b.myshopify.com', 'store.myshopify.com.evil.com', 'localhost:3000', '10.0.0.1', '', '-x', 'a b', 'x@y.myshopify.com']) expect(cleanShop(bad)).toBeNull();
  });
});

describe('Meta Lead Ads client', () => {
  const mk = (responses: { status?: number; body: unknown }[]) => { const f = fake(responses); return { ...f, c: new MetaLeadsClient({ appId: 'APP', appSecret: 'SEC', graphVersion: 'v26.0', baseUrl: 'https://g.test', fetchImpl: f.fetchImpl }) }; };
  it('refuses a malformed Graph version', () => { expect(() => new MetaLeadsClient({ appId: 'a', appSecret: 's', graphVersion: '26' })).toThrow(/META_GRAPH_VERSION/); });
  it('builds the login dialog with the lead scopes and our state', () => {
    const u = new URL(mk([]).c.authorizeUrl('https://app.test/cb', 'STATE1')); expect(u.pathname).toBe('/v26.0/dialog/oauth');
    expect(u.searchParams.get('state')).toBe('STATE1'); expect(u.searchParams.get('scope')).toBe('pages_show_list,pages_read_engagement,pages_manage_metadata,leads_retrieval,ads_management'); expect(u.searchParams.get('redirect_uri')).toBe('https://app.test/cb');
  });
  it('exchanges the code then upgrades to a long-lived token', async () => {
    const { c, calls } = mk([{ body: { access_token: 'short', expires_in: 3600 } }, { body: { access_token: 'long', expires_in: 5_000_000 } }]);
    expect((await c.exchangeCode('CODE', 'https://app.test/cb')).accessToken).toBe('short'); expect((await c.longLived('short')).accessToken).toBe('long');
    expect(new URL(calls[0]!.url).searchParams.get('code')).toBe('CODE'); expect(new URL(calls[1]!.url).searchParams.get('grant_type')).toBe('fb_exchange_token');
  });
  it('lists Pages across pages of results, each with its own token, and skips malformed rows', async () => {
    const { c } = mk([{ body: { data: [{ id: '1', name: 'A', access_token: 'ta' }, { nope: true }], paging: { next: 'https://g.test/v26.0/me/accounts?after=x' } } }, { body: { data: [{ id: '2', name: 'B', access_token: 'tb' }] } }]);
    expect((await c.listPages('U')).map((p) => [p.id, p.access_token])).toEqual([['1', 'ta'], ['2', 'tb']]);
  });
  it('reports granted and declined permissions', async () => {
    const { c } = mk([{ body: { data: [{ permission: 'leads_retrieval', status: 'granted' }, { permission: 'ads_management', status: 'declined' }] } }]);
    expect(await c.grantedPermissions('U')).toEqual({ granted: ['leads_retrieval'], declined: ['ads_management'] });
  });
  it('subscribes a Page to leadgen with the Page token, and fails loudly when Facebook does not confirm', async () => {
    const ok = mk([{ body: { success: true } }]); await ok.c.subscribePage('123', 'PT');
    const u = new URL(ok.calls[0]!.url); expect(u.pathname).toBe('/v26.0/123/subscribed_apps'); expect(u.searchParams.get('subscribed_fields')).toBe('leadgen'); expect(ok.calls[0]!.init.method).toBe('POST');
    await expect(mk([{ body: { success: false } }]).c.subscribePage('123', 'PT')).rejects.toThrow(/did not confirm/);
  });
  it('reads a lead with field_data and ad attribution; rejects a shape it does not know', async () => {
    const { c } = mk([{ body: { id: 'L1', created_time: '2026-11-13T00:00:00+0000', ad_id: 'AD1', form_id: 'F1', field_data: [{ name: 'full_name', values: ['Joe'] }, { name: 'phone_number', values: ['+919876543210'] }] } }, { body: { id: 5 } }]);
    const l = await c.getLead('L1', 'PT'); expect(l.field_data).toHaveLength(2); expect(l.ad_id).toBe('AD1');
    await expect(c.getLead('L2', 'PT')).rejects.toThrow(/shape/);
  });
  it('url-encodes ids so a crafted leadgen id cannot reach another Graph path', async () => {
    const { c, calls } = mk([{ body: { id: 'x', field_data: [] } }]); await c.getLead('../me', 'PT'); expect(new URL(calls[0]!.url).pathname).toBe('/v26.0/..%2Fme');
  });
  it('other Facebook errors (bad request, rate limit) do not force a re-connect', async () => {
    const { c } = mk([{ status: 400, body: { error: { message: 'Unsupported get request', code: 100 } } }]);
    const e = (await c.getLead('L', 'PT').catch((x: unknown) => x)) as ConnectorError; expect(e.needsReauth).toBe(false);
  });
  it('surfaces an expired token as needing re-connection', async () => {
    const { c } = mk([{ status: 400, body: { error: { message: 'Error validating access token', code: 190 } } }]);
    const e = (await c.getLead('L', 'PT').catch((x: unknown) => x)) as ConnectorError; expect(e).toBeInstanceOf(ConnectorError); expect(e.code).toBe('190'); expect(e.message).toMatch(/validating/); expect(e.needsReauth).toBe(true); expect(e.retryable).toBe(false);
  });
});

describe('Meta leadgen webhook parsing', () => {
  const body = { object: 'page', entry: [{ id: 153125381133, time: 1, changes: [{ field: 'leadgen', value: { leadgen_id: 123123123123, page_id: 123123123, form_id: 12312312312, adgroup_id: 9, ad_id: 12312312312, created_time: 1440120384 } }, { field: 'feed', value: { x: 1 } }, { field: 'leadgen', value: { page_id: 1 } }] }] };
  it('extracts leadgen events only, as strings, and skips ones without an id', () => {
    expect(parseLeadgenWebhook(body)).toEqual([{ pageId: '123123123', leadgenId: '123123123123', formId: '12312312312', adId: '12312312312', createdTime: 1440120384 }]);
  });
  it('ignores other objects and junk', () => { for (const b of [null, {}, { object: 'whatsapp_business_account', entry: [] }, { object: 'page' }, 'x']) expect(parseLeadgenWebhook(b)).toEqual([]); });
  it('maps a lead to our payload: ad attribution, organic flag, and consent only when a checkbox was ticked', () => {
    const l = { id: 'L1', ad_id: 'AD', form_id: 'F', is_organic: false, field_data: [{ name: 'phone_number', values: ['1'] }] } as never;
    expect(metaLeadToPayload(l)).toMatchObject({ leadgen_id: 'L1', ad_id: 'AD', utm_source: 'facebook_ads' }); expect(metaLeadToPayload(l)).not.toHaveProperty('whatsapp_consent');
    expect(metaLeadToPayload(l, true)).toMatchObject({ whatsapp_consent: 'yes' }); expect(metaLeadToPayload({ ...(l as object), is_organic: true } as never)).toMatchObject({ utm_source: 'facebook_organic' });
  });
});

describe('Shopify client and payload mapping', () => {
  const mk = (responses: { status?: number; body: unknown }[]) => { const f = fake(responses); return { ...f, c: new ShopifyClient({ clientId: 'CID', clientSecret: 'CSEC', apiVersion: '2026-10', fetchImpl: f.fetchImpl }) }; };
  it('authorize URL carries client id, scopes, redirect and state on the shop’s own host', () => {
    const u = new URL(mk([]).c.authorizeUrl('s.myshopify.com', 'https://app.test/cb', 'ST')); expect(u.host).toBe('s.myshopify.com'); expect(u.pathname).toBe('/admin/oauth/authorize');
    expect(u.searchParams.get('scope')).toBe('read_customers,read_orders,read_checkouts'); expect(u.searchParams.get('state')).toBe('ST'); expect(u.searchParams.get('client_id')).toBe('CID');
  });
  it('exchanges the code with a form body and returns the token', async () => {
    const { c, calls } = mk([{ body: { access_token: 'shpat_x', scope: 'read_customers,read_orders' } }]); const t = await c.exchangeCode('s.myshopify.com', 'CODE');
    expect(t.accessToken).toBe('shpat_x'); expect(calls[0]!.url).toBe('https://s.myshopify.com/admin/oauth/access_token'); expect(bodyOf(calls[0]!)).toContain('code=CODE'); expect(bodyOf(calls[0]!)).toContain('client_secret=CSEC');
  });
  it('subscribes through the GraphQL mutation with `uri`, and treats “already taken” as success but other errors as failure', async () => {
    const a = mk([{ body: { data: { webhookSubscriptionCreate: { userErrors: [], webhookSubscription: { id: 'gid://1' } } } } }]); await a.c.subscribe('s.myshopify.com', 'T', 'ORDERS_CREATE', 'https://h.test/hooks/shopify');
    const sent = JSON.parse(bodyOf(a.calls[0]!)); expect(sent.variables).toEqual({ topic: 'ORDERS_CREATE', sub: { uri: 'https://h.test/hooks/shopify', format: 'JSON' } }); expect((a.calls[0]!.init.headers as Headers).get('x-shopify-access-token')).toBe('T'); expect(a.calls[0]!.url).toContain('/admin/api/2026-10/graphql.json');
    await mk([{ body: { data: { webhookSubscriptionCreate: { userErrors: [{ message: 'Address for this topic has already been taken' }] } } } }]).c.subscribe('s.myshopify.com', 'T', 'ORDERS_CREATE', 'u');
    await expect(mk([{ body: { data: { webhookSubscriptionCreate: { userErrors: [{ message: 'Access denied' }] } } } }]).c.subscribe('s.myshopify.com', 'T', 'ORDERS_CREATE', 'u')).rejects.toThrow(/Access denied/);
  });
  it('a revoked token is a re-connect, not a retry', async () => {
    const e = (await mk([{ status: 401, body: { errors: 'Invalid API key or access token' } }]).c.shopInfo('s.myshopify.com', 'T').catch((x: unknown) => x)) as ConnectorError;
    expect(e.needsReauth).toBe(true); expect(e.retryable).toBe(false);
  });
  it('maps a customer, order and checkout; email/SMS marketing flags are NEVER WhatsApp consent', () => {
    const c = shopifyToPayload('customers/create', { id: 1, first_name: 'Asha', last_name: 'Verma', phone: '+919876543210', email: 'a@x.in', accepts_marketing: true, email_marketing_consent: { state: 'subscribed' }, default_address: { city: 'Pune' } })!;
    expect(c).toMatchObject({ external_id: 'customers/create:1', name: 'Asha Verma', phone: '+919876543210', city: 'Pune' }); expect(JSON.stringify(c)).not.toMatch(/consent|accepts_marketing/i);
    expect(shopifyToPayload('orders/create', { id: 9, name: '#1001', total_price: '499.00', currency: 'INR', customer: { first_name: 'R', last_name: 'K' }, shipping_address: { phone: '9876500001', city: 'Agra' } })).toMatchObject({ external_id: 'orders/create:9', order_number: '#1001', order_total: '499.00', phone: '9876500001', name: 'R K' });
    expect(shopifyToPayload('checkouts/create', { token: 'tok1', total_price: '99', abandoned_checkout_url: 'https://s/checkout/1', phone: '9876500002' })).toMatchObject({ external_id: 'checkouts/create:tok1', abandoned_checkout_url: 'https://s/checkout/1' });
    expect(shopifyToPayload('orders/create', { name: 'no id' })).toBeNull();
  });
});

describe('Google client', () => {
  const mk = (responses: { status?: number; body: unknown }[]) => { const f = fake(responses); return { ...f, c: new GoogleClient({ clientId: 'GID', clientSecret: 'GSEC', fetchImpl: f.fetchImpl, tokenUrl: 'https://t.test/token', sheetsBase: 'https://s.test' }) }; };
  it('asks for offline access with forced consent and PKCE so a refresh token is issued', () => {
    const u = new URL(mk([]).c.authorizeUrl('https://app.test/cb', 'ST', 'CH')); expect(u.searchParams.get('access_type')).toBe('offline'); expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('code_challenge')).toBe('CH'); expect(u.searchParams.get('code_challenge_method')).toBe('S256'); expect(u.searchParams.get('scope')).toContain('spreadsheets.readonly'); expect(u.searchParams.get('scope')).not.toContain('auth/spreadsheets '); expect(u.searchParams.get('state')).toBe('ST');
  });
  it('exchanges the code with the PKCE verifier and reads the account email from the id_token', async () => {
    const idt = `h.${Buffer.from(JSON.stringify({ email: 'o@x.in', sub: 'S1' })).toString('base64url')}.s`;
    const { c, calls } = mk([{ body: { access_token: 'a', refresh_token: 'r', expires_in: 3599, id_token: idt } }]); const t = await c.exchangeCode('CODE', 'https://app.test/cb', 'VER');
    expect(t).toMatchObject({ accessToken: 'a', refreshToken: 'r', email: 'o@x.in', sub: 'S1' }); expect(bodyOf(calls[0]!)).toContain('code_verifier=VER'); expect(bodyOf(calls[0]!)).toContain('grant_type=authorization_code');
  });
  it('refresh responses have no refresh token, so the caller keeps its own', async () => {
    const { c } = mk([{ body: { access_token: 'new', expires_in: 3599 } }]); const t = await c.refresh('R'); expect(t.accessToken).toBe('new'); expect(t.refreshToken).toBeNull();
  });
  it('reads sheet values as strings, url-encodes the range, and sends the bearer token', async () => {
    const { c, calls } = mk([{ body: { values: [['name', 'phone'], ['Asha', 9876543210], ['Ravi']] } }]); const v = await c.values('SID', 'Sheet1!A1:C100', 'TOK');
    expect(v).toEqual([['name', 'phone'], ['Asha', '9876543210'], ['Ravi']]); expect(calls[0]!.url).toContain('/v4/spreadsheets/SID/values/Sheet1!A1%3AC100'); expect((calls[0]!.init.headers as Headers).get('authorization')).toBe('Bearer TOK');
    expect(await mk([{ body: {} }]).c.values('S', 'A1', 'T')).toEqual([]);
  });
  it('invalid_grant on refresh means the owner revoked access: re-connect, never retry', async () => {
    const { c } = mk([{ status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }]);
    const e = (await c.refresh('R').catch((x: unknown) => x)) as ConnectorError; expect(e.code).toBe('invalid_grant'); expect(e.needsReauth).toBe(true); expect(e.retryable).toBe(false);
  });
  it('freshGoogleToken refreshes only when needed, and demands re-connection without a refresh token', async () => {
    const { c, calls } = mk([{ body: { access_token: 'new', expires_in: 3600 } }]);
    expect((await freshGoogleToken(c, { accessToken: 'old', refreshToken: 'R', expiresAt: new Date(Date.now() + 3_600_000) })).token).toBe('old'); expect(calls).toHaveLength(0);
    const r = await freshGoogleToken(c, { accessToken: 'old', refreshToken: 'R', expiresAt: new Date(Date.now() - 1000) }); expect(r.token).toBe('new'); expect(r.refreshed).not.toBeNull();
    await expect(freshGoogleToken(c, { accessToken: 'old', refreshToken: null, expiresAt: new Date(Date.now() - 1000) })).rejects.toThrow(/Connect again/);
  });
});

describe('network behaviour', () => {
  it('a network failure is retryable and never leaks the request secrets', async () => {
    const c = new GoogleClient({ clientId: 'G', clientSecret: 'TOPSECRET', fetchImpl: (async () => { throw new TypeError('fetch failed TOPSECRET'); }) as unknown as typeof fetch });
    const e = (await c.refresh('REFRESHSECRET').catch((x: unknown) => x)) as ConnectorError; expect(e.retryable).toBe(true); expect(e.status).toBe(0); expect(e.message).not.toContain('TOPSECRET'); expect(e.message).not.toContain('REFRESHSECRET');
  });
  it('5xx and 429 are retryable; 400 is not', async () => {
    for (const [s, r] of [[500, true], [503, true], [429, true], [400, false]] as const) {
      const f = fake([{ status: s, body: { error: 'x' } }]); const e = (await new GoogleClient({ clientId: 'G', clientSecret: 'S', fetchImpl: f.fetchImpl }).refresh('R').catch((x: unknown) => x)) as ConnectorError; expect(e.retryable).toBe(r);
    }
  });
});
