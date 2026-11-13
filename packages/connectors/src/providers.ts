import { z } from 'zod';
import { ConnectorError, http, needsRefresh, toTokenSet, type HttpOpts, type TokenSet } from './oauth';

/* ------------------------------------------------------------------------------------------------------------------------------------------
 * Meta Lead Ads (Facebook / Instagram instant forms).
 * Flow (Meta docs, "Retrieving Leads"): the owner logs in with Facebook and grants leads_retrieval, pages_show_list, pages_manage_metadata,
 * pages_read_engagement, ads_management. We list their Pages (each comes with its OWN Page access token), install our app on a Page so
 * `leadgen` webhooks arrive (POST /{page}/subscribed_apps?subscribed_fields=leadgen), and when a webhook carries a leadgen_id we GET /{leadgen_id}
 * with the Page token to read field_data. Nothing here guesses a field: an unexpected shape is returned as-is for the caller to log.
 * ---------------------------------------------------------------------------------------------------------------------------------------- */
export interface MetaLeadsConfig { appId: string; appSecret: string; graphVersion: string; baseUrl?: string; fetchImpl?: typeof fetch }
export const META_LEAD_SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval', 'ads_management'] as const;

const Page = z.object({ id: z.string(), name: z.string(), access_token: z.string().optional(), tasks: z.array(z.string()).optional() }).passthrough();
export type MetaPage = z.infer<typeof Page>;
const LeadResp = z.object({ id: z.string(), created_time: z.string().optional(), ad_id: z.string().nullish(), adset_id: z.string().nullish(), campaign_id: z.string().nullish(), form_id: z.string().nullish(), is_organic: z.boolean().nullish(),
  field_data: z.array(z.object({ name: z.string(), values: z.array(z.string()).default([]) })).default([]) }).passthrough();
export type MetaLead = z.infer<typeof LeadResp>;

export class MetaLeadsClient {
  constructor(private readonly c: MetaLeadsConfig) {
    if (!/^v\d+\.\d+$/.test(c.graphVersion)) throw new Error('META_GRAPH_VERSION must look like v26.0');
  }
  private o(): HttpOpts { return { fetchImpl: this.c.fetchImpl }; }
  private url(path: string, q: Record<string, string>) { return `${this.c.baseUrl ?? 'https://graph.facebook.com'}/${this.c.graphVersion}/${path}?${new URLSearchParams(q).toString()}`; }

  /** The dialog the owner is sent to. `state` ties the return to this browser session. */
  authorizeUrl(redirectUri: string, state: string): string {
    return `${this.c.baseUrl ? this.c.baseUrl : 'https://www.facebook.com'}/${this.c.graphVersion}/dialog/oauth?${new URLSearchParams({ client_id: this.c.appId, redirect_uri: redirectUri, state, scope: META_LEAD_SCOPES.join(','), response_type: 'code' })}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<{ accessToken: string; expiresAt: Date | null }> {
    const { json } = await http('meta', this.url('oauth/access_token', { client_id: this.c.appId, client_secret: this.c.appSecret, redirect_uri: redirectUri, code }), { method: 'GET' }, this.o());
    const t = toTokenSet(json); return { accessToken: t.accessToken, expiresAt: t.expiresAt };
  }
  /** Short-lived user token -> long-lived (about 60 days). Page tokens derived from a long-lived user token do not expire. */
  async longLived(userToken: string): Promise<{ accessToken: string; expiresAt: Date | null }> {
    const { json } = await http('meta', this.url('oauth/access_token', { grant_type: 'fb_exchange_token', client_id: this.c.appId, client_secret: this.c.appSecret, fb_exchange_token: userToken }), { method: 'GET' }, this.o());
    const t = toTokenSet(json); return { accessToken: t.accessToken, expiresAt: t.expiresAt };
  }
  async grantedPermissions(userToken: string): Promise<{ granted: string[]; declined: string[] }> {
    const { json } = await http('meta', this.url('me/permissions', { access_token: userToken }), { method: 'GET' }, this.o());
    const d = (json.data ?? []) as { permission: string; status: string }[];
    return { granted: d.filter((x) => x.status === 'granted').map((x) => x.permission), declined: d.filter((x) => x.status !== 'granted').map((x) => x.permission) };
  }
  async listPages(userToken: string): Promise<MetaPage[]> {
    const out: MetaPage[] = []; let next: string | null = this.url('me/accounts', { access_token: userToken, fields: 'id,name,access_token,tasks', limit: '100' });
    for (let i = 0; next && i < 10; i++) {
      const { json } = await http('meta', next, { method: 'GET' }, this.o());
      for (const p of (json.data ?? []) as unknown[]) { const r = Page.safeParse(p); if (r.success) out.push(r.data); }
      next = typeof json.paging?.next === 'string' ? json.paging.next : null;
    }
    return out;
  }
  /** Installs our app on the Page so leadgen webhooks start. */
  async subscribePage(pageId: string, pageToken: string): Promise<void> {
    const { json } = await http('meta', this.url(`${encodeURIComponent(pageId)}/subscribed_apps`, { subscribed_fields: 'leadgen', access_token: pageToken }), { method: 'POST' }, this.o());
    if (json.success !== true) throw new ConnectorError('meta', 502, 'subscribe_failed', 'Facebook did not confirm the Page subscription.');
  }
  async unsubscribePage(pageId: string, pageToken: string): Promise<void> {
    await http('meta', this.url(`${encodeURIComponent(pageId)}/subscribed_apps`, { access_token: pageToken }), { method: 'DELETE' }, this.o()).catch(() => undefined);
  }
  async getLead(leadgenId: string, pageToken: string): Promise<MetaLead> {
    const { json } = await http('meta', this.url(encodeURIComponent(leadgenId), { access_token: pageToken, fields: 'id,created_time,ad_id,adset_id,campaign_id,form_id,is_organic,field_data' }), { method: 'GET' }, this.o());
    const r = LeadResp.safeParse(json); if (!r.success) throw new ConnectorError('meta', 502, 'bad_lead', 'Facebook returned a lead in a shape we do not recognise.'); return r.data;
  }
  /** The optional consent checkboxes on a lead form are NOT in field_data; they come from custom_disclaimer_responses. */
  async getDisclaimers(leadgenId: string, pageToken: string): Promise<{ checkbox_key: string; is_checked: string }[]> {
    const { json } = await http('meta', this.url(encodeURIComponent(leadgenId), { access_token: pageToken, fields: 'custom_disclaimer_responses' }), { method: 'GET' }, this.o());
    return Array.isArray(json.custom_disclaimer_responses) ? json.custom_disclaimer_responses : [];
  }
  /** Leads created after `since` (unix seconds) for a form, for catching up on anything a webhook missed. */
  async listFormLeads(formId: string, pageToken: string, since: number, limit = 100): Promise<MetaLead[]> {
    const q = { access_token: pageToken, fields: 'id,created_time,ad_id,form_id,is_organic,field_data', limit: String(limit), filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: since }]) };
    const { json } = await http('meta', this.url(`${encodeURIComponent(formId)}/leads`, q), { method: 'GET' }, this.o());
    return ((json.data ?? []) as unknown[]).flatMap((x) => { const r = LeadResp.safeParse(x); return r.success ? [r.data] : []; });
  }
}

/** A leadgen webhook is a Page-object change: entry[].changes[] with field "leadgen". Returns what we need and ignores everything else. */
export interface LeadgenEvent { pageId: string; leadgenId: string; formId: string | null; adId: string | null; createdTime: number | null }
export function parseLeadgenWebhook(body: unknown): LeadgenEvent[] {
  const out: LeadgenEvent[] = []; const b = body as { object?: string; entry?: { id?: string | number; changes?: { field?: string; value?: Record<string, unknown> }[] }[] } | null;
  if (!b || b.object !== 'page' || !Array.isArray(b.entry)) return out;
  for (const e of b.entry) for (const ch of e.changes ?? []) {
    if (ch.field !== 'leadgen' || !ch.value) continue;
    const v = ch.value; const lg = v.leadgen_id; const page = v.page_id ?? e.id;
    if (lg === undefined || lg === null || page === undefined || page === null) continue;
    out.push({ pageId: String(page), leadgenId: String(lg), formId: v.form_id != null ? String(v.form_id) : null, adId: v.ad_id != null ? String(v.ad_id) : null, createdTime: typeof v.created_time === 'number' ? v.created_time : null });
  }
  return out;
}

/** Turns a Meta lead into the flat shape our lead extractor reads (it already understands field_data pairs, so this only adds ad attribution). */
export function metaLeadToPayload(l: MetaLead, consentChecked?: boolean): Record<string, unknown> {
  const p: Record<string, unknown> = { leadgen_id: l.id, field_data: l.field_data, utm_source: l.is_organic ? 'facebook_organic' : 'facebook_ads' };
  if (l.ad_id) p.ad_id = l.ad_id; if (l.form_id) p.form_id = l.form_id; if (l.campaign_id) p.campaign_id = l.campaign_id;
  if (consentChecked) p.whatsapp_consent = 'yes';
  return p;
}

/* ------------------------------------------------------------------------------------------------------------------------------------------
 * Shopify. Authorization code grant (shopify.dev): redirect to https://{shop}/admin/oauth/authorize?client_id&scope&redirect_uri&state, verify the
 * callback (hmac, state, shop hostname), POST https://{shop}/admin/oauth/access_token {client_id, client_secret, code}. Requests carry
 * X-Shopify-Access-Token. Webhooks are subscribed with the GraphQL mutation webhookSubscriptionCreate (field `uri`; the old callbackUrl is deprecated).
 * ---------------------------------------------------------------------------------------------------------------------------------------- */
export interface ShopifyConfig { clientId: string; clientSecret: string; apiVersion: string; fetchImpl?: typeof fetch; scheme?: 'https' | 'http'; hostOverride?: string }
export const SHOPIFY_SCOPES = ['read_customers', 'read_orders', 'read_checkouts'] as const;
export const SHOPIFY_TOPICS = ['CUSTOMERS_CREATE', 'ORDERS_CREATE', 'CHECKOUTS_CREATE', 'APP_UNINSTALLED'] as const;

export class ShopifyClient {
  constructor(private readonly c: ShopifyConfig) { if (!/^\d{4}-\d{2}$|^unstable$/.test(c.apiVersion)) throw new Error('SHOPIFY_API_VERSION must look like 2026-10'); }
  private base(shop: string) { return `${this.c.scheme ?? 'https'}://${this.c.hostOverride ?? shop}`; }
  private o(): HttpOpts { return { fetchImpl: this.c.fetchImpl }; }
  authorizeUrl(shop: string, redirectUri: string, state: string): string {
    return `${this.base(shop)}/admin/oauth/authorize?${new URLSearchParams({ client_id: this.c.clientId, scope: SHOPIFY_SCOPES.join(','), redirect_uri: redirectUri, state })}`;
  }
  async exchangeCode(shop: string, code: string): Promise<TokenSet> {
    const { json } = await http('shopify', `${this.base(shop)}/admin/oauth/access_token`, { method: 'POST', headers: { accept: 'application/json' }, form: { client_id: this.c.clientId, client_secret: this.c.clientSecret, code } }, this.o());
    return toTokenSet(json);
  }
  private async gql(shop: string, token: string, query: string, variables: Record<string, unknown>) {
    const { json } = await http('shopify', `${this.base(shop)}/admin/api/${this.c.apiVersion}/graphql.json`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-access-token': token }, body: JSON.stringify({ query, variables }) }, this.o());
    if (Array.isArray(json.errors) && json.errors.length) throw new ConnectorError('shopify', 502, 'graphql_error', String(json.errors[0]?.message ?? 'Shopify returned an error.'));
    return json.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  async shopInfo(shop: string, token: string): Promise<{ name: string; email: string | null }> {
    const d = await this.gql(shop, token, '{ shop { name email } }', {}); return { name: String(d.shop?.name ?? shop), email: d.shop?.email ?? null };
  }
  /** Idempotent: a topic that is already subscribed counts as success. */
  async subscribe(shop: string, token: string, topic: (typeof SHOPIFY_TOPICS)[number], uri: string): Promise<void> {
    const d = await this.gql(shop, token, `mutation($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) { userErrors { field message } webhookSubscription { id } } }`, { topic, sub: { uri, format: 'JSON' } });
    const errs = (d.webhookSubscriptionCreate?.userErrors ?? []) as { message: string }[];
    if (errs.length && !errs.every((e) => /already been taken|already exists/i.test(e.message))) throw new ConnectorError('shopify', 422, 'subscribe_failed', errs[0]!.message);
  }
}

/** The fields a Shopify customer / order / checkout webhook carries that we use. Everything else is ignored. */
export function shopifyToPayload(topic: string, b: Record<string, any>): Record<string, unknown> | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  const cust = (topic.startsWith('customers/') ? b : b.customer) ?? {};
  const ship = b.shipping_address ?? b.billing_address ?? cust.default_address ?? {};
  const phone = b.phone ?? cust.phone ?? ship.phone ?? b.shipping_address?.phone ?? null;
  const first = cust.first_name ?? ship.first_name ?? '', last = cust.last_name ?? ship.last_name ?? '';
  const id = b.id ?? b.token;
  if (id === undefined || id === null) return null;
  const out: Record<string, unknown> = { external_id: `${topic}:${id}`, phone, name: [first, last].filter(Boolean).join(' ') || ship.name || null, email: b.email ?? cust.email ?? null, city: ship.city ?? null };
  if (topic.startsWith('orders/')) { out.order_number = b.name ?? b.order_number; out.order_total = b.total_price; out.currency = b.currency; }
  if (topic.startsWith('checkouts/')) { out.checkout_total = b.total_price; out.abandoned_checkout_url = b.abandoned_checkout_url; }
  // Shopify's own marketing opt-in flag is email/SMS, not WhatsApp. It is NEVER mapped to WhatsApp consent.
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== null && v !== undefined && v !== ''));
}

/* ------------------------------------------------------------------------------------------------------------------------------------------
 * Google Sheets (read-only): web server flow with access_type=offline&prompt=consent so a refresh_token is issued, token + refresh at
 * https://oauth2.googleapis.com/token (form body), values at GET https://sheets.googleapis.com/v4/spreadsheets/{id}/values/{range}.
 * A refresh response has no refresh_token (the old one stays valid), so the caller keeps the one it has.
 * ---------------------------------------------------------------------------------------------------------------------------------------- */
export interface GoogleConfig { clientId: string; clientSecret: string; fetchImpl?: typeof fetch; authBase?: string; tokenUrl?: string; sheetsBase?: string }
export const GOOGLE_SHEETS_SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive.metadata.readonly'] as const;

export class GoogleClient {
  constructor(private readonly c: GoogleConfig) {}
  private o(): HttpOpts { return { fetchImpl: this.c.fetchImpl }; }
  private get tokenUrl() { return this.c.tokenUrl ?? 'https://oauth2.googleapis.com/token'; }
  authorizeUrl(redirectUri: string, state: string, challenge: string): string {
    return `${this.c.authBase ?? 'https://accounts.google.com/o/oauth2/v2/auth'}?${new URLSearchParams({ client_id: this.c.clientId, redirect_uri: redirectUri, response_type: 'code', scope: ['openid', 'email', ...GOOGLE_SHEETS_SCOPES].join(' '), state, access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256' })}`;
  }
  async exchangeCode(code: string, redirectUri: string, verifier: string): Promise<TokenSet & { email: string | null; sub: string | null }> {
    const { json } = await http('google', this.tokenUrl, { method: 'POST', form: { grant_type: 'authorization_code', code, client_id: this.c.clientId, client_secret: this.c.clientSecret, redirect_uri: redirectUri, code_verifier: verifier } }, this.o());
    const t = toTokenSet(json); let email: string | null = null, sub: string | null = null;
    if (typeof json.id_token === 'string') { try { const p = JSON.parse(Buffer.from(json.id_token.split('.')[1]!, 'base64url').toString('utf8')); email = p.email ?? null; sub = p.sub ?? null; } catch { /* id_token is informational only */ } }
    return { ...t, email, sub };
  }
  async refresh(refreshToken: string): Promise<TokenSet> {
    const { json } = await http('google', this.tokenUrl, { method: 'POST', form: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: this.c.clientId, client_secret: this.c.clientSecret } }, this.o());
    return toTokenSet(json);
  }
  async values(spreadsheetId: string, range: string, token: string): Promise<string[][]> {
    const { json } = await http('google', `${this.c.sheetsBase ?? 'https://sheets.googleapis.com'}/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`, { method: 'GET', headers: { authorization: `Bearer ${token}` } }, this.o());
    return Array.isArray(json.values) ? (json.values as unknown[][]).map((r) => r.map((c) => String(c ?? ''))) : [];
  }
}

/** Returns a usable access token, refreshing first when it is about to expire. */
export async function freshGoogleToken(g: GoogleClient, cur: { accessToken: string; refreshToken: string | null; expiresAt: Date | null }): Promise<{ token: string; refreshed: TokenSet | null }> {
  if (!needsRefresh(cur.expiresAt)) return { token: cur.accessToken, refreshed: null };
  if (!cur.refreshToken) throw new ConnectorError('google', 401, 'invalid_grant', 'Google did not give us permission to stay connected. Connect again.');
  const t = await g.refresh(cur.refreshToken); return { token: t.accessToken, refreshed: t };
}
