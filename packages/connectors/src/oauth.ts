import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The parts of OAuth 2.0 every connector shares. Written from the platforms' own docs: authorization code flow with a one-time `state`
 * (checked on return so a link someone else started cannot be completed in your session), PKCE where the provider supports it,
 * form-encoded token calls, and refresh before expiry.
 */
export class ConnectorError extends Error {
  constructor(public readonly provider: string, public readonly status: number, public readonly code: string | undefined, message: string) {
    super(message);
    this.name = 'ConnectorError';
  }
  /** The user must connect again: the grant was revoked or expired. Retrying will never help. */
  get needsReauth() { return this.code === 'invalid_grant' || this.code === 'invalid_token' || this.status === 401 || this.status === 403 || (this.provider.startsWith('meta') && ['190', '102', '463', '467'].includes(this.code ?? '')); }
  get retryable() { return this.status === 0 || this.status === 429 || this.status >= 500; }
}

export const newState = (): string => randomBytes(24).toString('base64url');
export const hashState = (s: string): string => createHash('sha256').update(s).digest('hex');

/** RFC 7636. The verifier stays on our side; only its S256 hash goes to the provider. */
export function newPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export interface TokenSet { accessToken: string; refreshToken: string | null; expiresAt: Date | null; scopes: string[] }

/** Normalises the standard token response. `expires_in` is seconds from now; a missing value means the token does not expire. */
export function toTokenSet(j: Record<string, unknown>, now = Date.now()): TokenSet {
  const at = typeof j.access_token === 'string' ? j.access_token : '';
  if (!at) throw new ConnectorError('oauth', 502, 'bad_token_response', 'The platform did not return an access token.');
  const exp = typeof j.expires_in === 'number' && j.expires_in > 0 ? new Date(now + j.expires_in * 1000) : null;
  const rt = typeof j.refresh_token === 'string' && j.refresh_token ? j.refresh_token : null;
  const sc = typeof j.scope === 'string' ? j.scope.split(/[,\s]+/).filter(Boolean) : [];
  return { accessToken: at, refreshToken: rt, expiresAt: exp, scopes: sc };
}

/** Refresh slightly early so a token never expires in the middle of a sync. */
export const needsRefresh = (expiresAt: Date | null | undefined, now = Date.now(), skewMs = 120_000): boolean => !!expiresAt && expiresAt.getTime() - skewMs <= now;

export interface HttpOpts { fetchImpl?: typeof fetch; timeoutMs?: number }

/** One JSON/form call with a timeout. Errors carry the platform's own error code when it sent one, and never the request body (it holds secrets). */
export async function http(provider: string, url: string, init: RequestInit & { form?: Record<string, string> }, o: HttpOpts = {}): Promise<{ status: number; json: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), o.timeoutMs ?? 15_000);
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.form) { headers.set('content-type', 'application/x-www-form-urlencoded'); body = new URLSearchParams(init.form).toString(); }
  let res: Response;
  try { res = await (o.fetchImpl ?? fetch)(url, { ...init, headers, body, signal: ctl.signal }); }
  catch (e) { throw new ConnectorError(provider, 0, 'network', `Could not reach ${provider}: ${(e as Error).name}`); }
  finally { clearTimeout(t); }
  const text = await res.text(); let json: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
  if (!res.ok) {
    const err = json.error;
    const code = typeof err === 'string' ? err : err?.code !== undefined ? String(err.code) : err?.status ? String(err.status) : undefined;
    const msg = (typeof json.error_description === 'string' && json.error_description) || (typeof err === 'object' && err?.message) || (typeof err === 'string' && err) || `${provider} returned HTTP ${res.status}`;
    throw new ConnectorError(provider, res.status, code, String(msg));
  }
  return { status: res.status, json };
}

/** Constant-time string compare for MACs. */
export function safeEqual(a: string, b: string): boolean { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }

/** Shopify signs the raw webhook body with base64(HMAC-SHA256(body, client secret)) in X-Shopify-Hmac-Sha256. */
export function verifyShopifyWebhook(raw: Buffer | string, header: string | undefined | null, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  const given = Buffer.from(header.trim(), 'base64');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Shopify signs OAuth redirects and install requests: remove `hmac`, sort the rest, join as key=value with &, HMAC-SHA256 with the client secret, hex.
 * Values are used as received (already decoded by the URL parser), which matches Shopify's own library.
 */
export function verifyShopifyQuery(params: URLSearchParams, secret: string): boolean {
  const given = params.get('hmac'); if (!given || !secret) return false;
  const pairs: string[] = []; params.forEach((v, k) => { if (k !== 'hmac') pairs.push(`${k}=${v}`); });
  const expected = createHmac('sha256', secret).update(pairs.sort().join('&')).digest('hex');
  return safeEqual(expected, given.toLowerCase());
}

/** Only real Shopify store hostnames are ever contacted, so this flow cannot be turned into a request to an arbitrary server (SSRF). */
export const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
export function cleanShop(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (SHOP_RE.test(s)) return s;
  return /^[a-z0-9][a-z0-9-]*$/.test(s) ? `${s}.myshopify.com` : null;
}
