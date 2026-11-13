import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GraphClient, SignupError, completeSignup, decryptSecret, generatePin } from '../src';

type Route = (url: URL, method: string, body: any) => { status: number; body: unknown };
let server: Server, base = '';
const calls: { method: string; path: string; query: Record<string, string>; auth?: string; body: any }[] = [];
let routes: Record<string, Route> = {};
const ok = (body: unknown) => ({ status: 200, body });
const err = (code: number, extra: object = {}) => ({ status: 400, body: { error: { message: 'x', code, ...extra } } });

beforeAll(async () => {
  server = createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => {
      const u = new URL(req.url!, base);
      const path = u.pathname.replace(/^\/v26\.0\//, '');
      calls.push({ method: req.method!, path, query: Object.fromEntries(u.searchParams), auth: req.headers.authorization, body: b ? JSON.parse(b) : undefined });
      const key = Object.keys(routes).find((k) => { const [m, p] = k.split(' '); return m === req.method && new RegExp('^' + p!.replace(/:[a-z]+/g, '[^/]+') + '$').test(path); });
      const r = key ? routes[key]!(u, req.method!, b ? JSON.parse(b) : undefined) : { status: 404, body: { error: { message: 'no route', code: 100 } } };
      res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

const KEY = randomBytes(32).toString('base64');
const graph = () => new GraphClient({ graphVersion: 'v26.0', baseUrl: base, appId: 'APP1', appSecret: 'SECRET1', timeoutMs: 2000 });
const good = (over: Partial<Record<string, Route>> = {}) => ({
  'GET oauth/access_token': () => ok({ access_token: 'BIZ-TOKEN' }),
  'GET debug_token': () => ok({ data: { is_valid: true, scopes: ['whatsapp_business_management', 'whatsapp_business_messaging', 'public_profile'] } }),
  'POST :id/subscribed_apps': () => ok({ success: true }),
  'GET :id/phone_numbers': () => ok({ data: [{ id: 'PN1', display_phone_number: '+91 98765 43210', verified_name: 'Sharma Fitness', quality_rating: 'GREEN', status: 'PENDING', platform_type: 'NOT_APPLICABLE', throughput: { level: 'STANDARD' } }] }),
  'POST :id/register': () => ok({ success: true }),
  'GET :id': () => ok({ id: 'W1', marketing_messages_lite_api_status: 'ONBOARDED', disable_marketing_messages_on_cloud_api: false }),
  ...over,
} as Record<string, Route>);
const info = { waba_id: 'W1', business_id: 'B1', phone_number_id: 'PN1' };
beforeEach(() => { calls.length = 0; routes = good(); });
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as SignupError; } throw new Error('expected a SignupError'); };

describe('Embedded Signup server steps', () => {
  it('happy path: exchanges the code with the app secret, checks scopes, subscribes, registers with a PIN, and returns an encrypted token', async () => {
    const r = await completeSignup({ graph: graph(), code: 'CODE1', sessionInfo: info, tokenKey: KEY, pin: () => '123456' });
    expect(r).toMatchObject({ wabaId: 'W1', businessId: 'B1', registered: true, mmStatus: 'ONBOARDED', disableMarketingOnCloudApi: false });
    expect(r.phone).toMatchObject({ id: 'PN1', display: '+91 98765 43210', verifiedName: 'Sharma Fitness', quality: 'GREEN' });
    expect(r.tokenEnc).not.toContain('BIZ-TOKEN');
    expect(decryptSecret(r.tokenEnc, KEY)).toBe('BIZ-TOKEN');
    expect(decryptSecret(r.pinEnc!, KEY)).toBe('123456');
    const x = calls.find((c) => c.path === 'oauth/access_token')!;
    expect(x.query).toMatchObject({ client_id: 'APP1', client_secret: 'SECRET1', code: 'CODE1' });
    expect(calls.find((c) => c.path === 'W1/subscribed_apps')!.auth).toBe('Bearer BIZ-TOKEN');
    expect(calls.find((c) => c.path === 'PN1/register')!.body).toEqual({ messaging_product: 'whatsapp', pin: '123456' });
    expect(calls.map((c) => c.path)).toEqual(['oauth/access_token', 'debug_token', 'W1/subscribed_apps', 'W1/phone_numbers', 'PN1/register', 'W1']);
  });
  it('the result never contains the plaintext token or PIN', async () => {
    const r = await completeSignup({ graph: graph(), code: 'C', sessionInfo: info, tokenKey: KEY, pin: () => '654321' });
    const s = JSON.stringify(r);
    expect(s).not.toContain('BIZ-TOKEN'); expect(s).not.toContain('654321');
  });
  it('an expired code fails with a retry message, and nothing else is called', async () => {
    routes['GET oauth/access_token'] = () => err(100, { error_subcode: 36007 });
    const e = await fails(completeSignup({ graph: graph(), code: 'OLD', sessionInfo: info, tokenKey: KEY }));
    expect(e.reason).toBe('code_exchange_failed'); expect(e.userMessage).toMatch(/expired|again/i); expect(calls).toHaveLength(1);
  });
  it('refuses a token missing a required permission, and does not subscribe', async () => {
    routes['GET debug_token'] = () => ok({ data: { is_valid: true, scopes: ['public_profile', 'whatsapp_business_management'] } });
    const e = await fails(completeSignup({ graph: graph(), code: 'C', sessionInfo: info, tokenKey: KEY }));
    expect(e.reason).toBe('missing_permission'); expect(calls.some((c) => c.path.endsWith('subscribed_apps'))).toBe(false);
  });
  it('refuses an invalid token', async () => {
    routes['GET debug_token'] = () => ok({ data: { is_valid: false } });
    expect((await fails(completeSignup({ graph: graph(), code: 'C', sessionInfo: info, tokenKey: KEY }))).reason).toBe('token_invalid');
  });
  it('fails clearly when the popup never reported a WhatsApp account (never guesses)', async () => {
    expect((await fails(completeSignup({ graph: graph(), code: 'C', sessionInfo: { business_id: 'B1' }, tokenKey: KEY }))).reason).toBe('no_waba');
    expect((await fails(completeSignup({ graph: graph(), code: 'C', sessionInfo: null, tokenKey: KEY }))).reason).toBe('no_waba');
  });
  it('subscribe error 200 / 1349174 says permission was not given', async () => {
    routes['POST :id/subscribed_apps'] = () => err(1349174);
    const e = await fails(completeSignup({ graph: graph(), code: 'C', sessionInfo: info, tokenKey: KEY }));
    expect(e).toMatchObject({ reason: 'subscribe_failed', metaCode: 1349174 }); expect(e.userMessage).toMatch(/permission/i);
  });
  it('no number on the account is a clear failure; several numbers need the popup to say which', async () => {
    routes['GET :id/phone_numbers'] = () => ok({ data: [] });
    expect((await fails(completeSignup({ graph: graph(), code: 'C', sessionInfo: { waba_id: 'W1' }, tokenKey: KEY }))).reason).toBe('no_phone_number');
    routes['GET :id/phone_numbers'] = () => ok({ data: [{ id: 'A' }, { id: 'B' }] });
    const e = await fails(completeSignup({ graph: graph(), code: 'C', sessionInfo: { waba_id: 'W1' }, tokenKey: KEY }));
    expect(e.reason).toBe('no_phone_number'); expect(e.userMessage).toMatch(/more than one/i);
  });
  it('picks the number the popup reported when there are several', async () => {
    routes['GET :id/phone_numbers'] = () => ok({ data: [{ id: 'A', display_phone_number: '+91 1' }, { id: 'B', display_phone_number: '+91 2', status: 'PENDING' }] });
    const r = await completeSignup({ graph: graph(), code: 'C', sessionInfo: { ...info, phone_number_id: 'B' }, tokenKey: KEY });
    expect(r.phone.id).toBe('B'); expect(calls.find((c) => c.path.endsWith('/register'))!.path).toBe('B/register');
  });
  it('a number already used in the WhatsApp Business app is NOT registered with a PIN', async () => {
    routes['GET :id/phone_numbers'] = () => ok({ data: [{ id: 'PN1', display_phone_number: '+91 9', is_on_biz_app: true, platform_type: 'CLOUD_API', status: 'CONNECTED' }] });
    const r = await completeSignup({ graph: graph(), code: 'C', sessionInfo: info, tokenKey: KEY });
    expect(r.pinEnc).toBeNull(); expect(r.registered).toBe(true); expect(calls.some((c) => c.path.endsWith('/register'))).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/Business app/);
  });
  it('error 133016 (registered too many times) blocks with a 72 hour message', async () => {
    routes['POST :id/register'] = () => err(133016);
    const e = await fails(completeSignup({ graph: graph(), code: 'C', sessionInfo: info, tokenKey: KEY }));
    expect(e).toMatchObject({ reason: 'register_failed', metaCode: 133016 }); expect(e.userMessage).toMatch(/72 hours/);
  });
  it('another register failure still stores the connection but warns, and keeps no PIN', async () => {
    routes['POST :id/register'] = () => err(131000);
    const r = await completeSignup({ graph: graph(), code: 'C', sessionInfo: info, tokenKey: KEY });
    expect(r.registered).toBe(false); expect(r.pinEnc).toBeNull(); expect(r.warnings.length).toBeGreaterThan(0);
  });
  it('a failed promotional-readiness check is a warning, not a failure', async () => {
    routes['GET :id'] = () => err(100);
    const r = await completeSignup({ graph: graph(), code: 'C', sessionInfo: info, tokenKey: KEY });
    expect(r.mmStatus).toBeNull(); expect(r.warnings.join(' ')).toMatch(/promotional/);
  });
  it('a Meta outage while exchanging reads as try again, not as a bad code', async () => {
    routes['GET oauth/access_token'] = () => ({ status: 500, body: { error: { message: 'x', code: 2, is_transient: true } } });
    expect((await fails(completeSignup({ graph: graph(), code: 'C', sessionInfo: info, tokenKey: KEY }))).userMessage).toMatch(/did not answer|again/i);
  });
  it('generatePin gives six digits, with leading zeros kept', () => {
    for (let i = 0; i < 200; i++) expect(generatePin()).toMatch(/^\d{6}$/);
  });
});
