import { errorPolicy, type ErrorPolicy, type GraphError } from '@lbc/shared';

/**
 * The only place that talks to the Meta Graph API (AGENTS.md rule 2). The version comes from env META_GRAPH_VERSION and is
 * never written anywhere else. Secrets are passed per call and never logged.
 */
export interface MetaConfig {
  graphVersion: string;
  /** Test/mocking hook only. Production leaves this unset so requests go to graph.facebook.com. */
  baseUrl?: string;
  appId?: string;
  appSecret?: string;
  /** Injected for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class MetaError extends Error {
  readonly policy: ErrorPolicy;
  constructor(public readonly status: number, public readonly graph: GraphError, public readonly path: string) {
    super(graph.message ?? `Graph error ${graph.code ?? status}`);
    this.name = 'MetaError';
    this.policy = errorPolicy(graph.code);
  }
  get code() { return this.graph.code; }
  get isTransient() { return this.graph.is_transient === true; }
}

/** A network failure or timeout. The request may or may not have been accepted, so marketing sends must NOT be blindly retried (spec 4.5 step 6). */
export class MediaTooLarge extends Error { constructor(readonly size: number) { super(`File is ${size} bytes, over the limit.`); this.name = 'MediaTooLarge'; } }
export class MetaUnknownOutcome extends Error {
  constructor(public readonly path: string, public readonly cause_: unknown) {
    super('Meta request outcome unknown (timeout or network error)');
    this.name = 'MetaUnknownOutcome';
  }
}

export class GraphClient {
  constructor(private readonly cfg: MetaConfig) {
    if (!/^v\d+\.\d+$/.test(cfg.graphVersion)) throw new Error('META_GRAPH_VERSION must look like v26.0');
  }

  url(path: string, query?: Record<string, string | number | undefined>): string {
    const u = new URL(`${(this.cfg.baseUrl ?? 'https://graph.facebook.com').replace(/\/+$/, '')}/${this.cfg.graphVersion}/${path.replace(/^\/+/, '')}`);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
    return u.toString();
  }

  async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, opts: { token?: string; body?: unknown; query?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const f = this.cfg.fetchImpl ?? fetch;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs ?? 20_000);
    let res: Response;
    try {
      res = await f(this.url(path, opts.query), {
        method,
        headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ctl.signal,
      });
    } catch (e) {
      throw new MetaUnknownOutcome(path, e);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: unknown = undefined;
    try { json = text ? JSON.parse(text) : undefined; } catch { /* non-JSON body */ }
    if (!res.ok) {
      const err = (json as { error?: GraphError } | undefined)?.error;
      // A 5xx with no parseable body: the message may have been accepted. Treat as unknown outcome.
      if (!err && res.status >= 500) throw new MetaUnknownOutcome(path, `HTTP ${res.status}`);
      throw new MetaError(res.status, err ?? { message: `HTTP ${res.status}` }, path);
    }
    return json as T;
  }

  // ---- Embedded Signup server steps (spec 2.2) ----

  /** Step 5: exchange the 30-second code for the business token. Server-side only: needs the app secret. */
  async exchangeCode(code: string): Promise<{ access_token: string }> {
    if (!this.cfg.appId || !this.cfg.appSecret) throw new Error('META_APP_ID and META_APP_SECRET are required');
    return this.request('GET', 'oauth/access_token', { query: { client_id: this.cfg.appId, client_secret: this.cfg.appSecret, code } });
  }

  /** Step 6: scopes and validity of a token. */
  async debugToken(token: string): Promise<{ data: { is_valid: boolean; scopes?: string[]; expires_at?: number; data_access_expires_at?: number } }> {
    if (!this.cfg.appId || !this.cfg.appSecret) throw new Error('META_APP_ID and META_APP_SECRET are required');
    return this.request('GET', 'debug_token', { query: { input_token: token, access_token: `${this.cfg.appId}|${this.cfg.appSecret}` } });
  }

  /** Step 7: subscribe our app to the tenant's WABA webhooks. */
  subscribeApp(wabaId: string, token: string) { return this.request<{ success: boolean }>('POST', `${wabaId}/subscribed_apps`, { token }); }
  listSubscribedApps(wabaId: string, token: string) { return this.request<{ data: unknown[] }>('GET', `${wabaId}/subscribed_apps`, { token }); }

  /** Step 8: the phone numbers on the WABA. */
  listPhoneNumbers(wabaId: string, token: string) {
    return this.request<{ data: PhoneNumber[] }>('GET', `${wabaId}/phone_numbers`, { token, query: { fields: 'id,display_phone_number,verified_name,quality_rating,status,code_verification_status,name_status,account_mode,platform_type,is_on_biz_app,throughput' } });
  }

  /** Step 9 (standard path only): register the number for Cloud API with a 2FA PIN. */
  registerNumber(phoneNumberId: string, pin: string, token: string) {
    return this.request<{ success: boolean }>('POST', `${phoneNumberId}/register`, { token, body: { messaging_product: 'whatsapp', pin } });
  }

  /** Step 11: Marketing Messages API status on the WABA. */
  wabaStatus(wabaId: string, token: string) {
    return this.request<{ id: string; marketing_messages_lite_api_status?: string; disable_marketing_messages_on_cloud_api?: boolean }>('GET', wabaId, { token, query: { fields: 'marketing_messages_lite_api_status,disable_marketing_messages_on_cloud_api' } });
  }

  // ---- Sending (spec 4) ----
  sendMessage(phoneNumberId: string, token: string, body: unknown) { return this.request<SendResponse>('POST', `${phoneNumberId}/messages`, { token, body }); }
  sendMarketingMessage(phoneNumberId: string, token: string, body: unknown) { return this.request<SendResponse>('POST', `${phoneNumberId}/marketing_messages`, { token, body }); }
  markRead(phoneNumberId: string, token: string, messageId: string) { return this.request<{ success: boolean }>('POST', `${phoneNumberId}/messages`, { token, body: { messaging_product: 'whatsapp', status: 'read', message_id: messageId } }); }

  // ---- Templates (spec 7.1) ----
  /**
   * Resumable Upload (Meta "Upload a file"): 1) POST /<APP_ID>/uploads?file_name&file_length&file_type -> {id: "upload:<session>"};
   * 2) POST /upload:<session> with header `Authorization: OAuth <token>` and `file_offset: 0` and the raw bytes -> {h: "<handle>"}.
   * The handle is the sample for a template's media header. Valid types: image/jpeg, image/png, video/mp4, application/pdf.
   */
  async uploadTemplateSample(token: string, file: { name: string; mime: string; bytes: Uint8Array }): Promise<string> {
    if (!this.cfg.appId) throw new Error('META_APP_ID is required');
    if (!['image/jpeg', 'image/png', 'video/mp4', 'application/pdf'].includes(file.mime)) throw new Error('Unsupported header file type');
    const s = await this.request<{ id?: string }>('POST', `${this.cfg.appId}/uploads`, { token, query: { file_name: file.name, file_length: file.bytes.length, file_type: file.mime } });
    if (!s?.id || !/^upload:/.test(s.id)) throw new MetaError(502, { message: 'Meta did not start an upload session.' }, 'uploads');
    const f = this.cfg.fetchImpl ?? fetch;
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs ?? 60_000);
    let res: Response;
    try { res = await f(this.url(s.id), { method: 'POST', headers: { Authorization: `OAuth ${token}`, file_offset: '0' }, body: file.bytes as BodyInit, signal: ctl.signal }); }
    catch (e) { throw new MetaUnknownOutcome('upload', e); } finally { clearTimeout(timer); }
    const text = await res.text(); let json: { h?: string; error?: GraphError } = {};
    try { json = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }
    if (!res.ok) throw new MetaError(res.status, json.error ?? { message: `HTTP ${res.status}` }, 'upload');
    if (!json.h) throw new MetaError(502, { message: 'Meta did not return a file handle.' }, 'upload');
    return json.h;
  }

  /** Upload media to a sending number (Cloud API Media): multipart with messaging_product, file and type. Returns the media id (valid 30 days). */
  async uploadMedia(phoneNumberId: string, token: string, file: { name: string; mime: string; bytes: Uint8Array }): Promise<string> {
    const f = this.cfg.fetchImpl ?? fetch;
    const form = new FormData();
    form.set('messaging_product', 'whatsapp'); form.set('type', file.mime);
    form.set('file', new Blob([file.bytes as BlobPart], { type: file.mime }), file.name);
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs ?? 60_000);
    let res: Response;
    try { res = await f(this.url(`${phoneNumberId}/media`), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form, signal: ctl.signal }); }
    catch (e) { throw new MetaUnknownOutcome('media', e); } finally { clearTimeout(timer); }
    const text = await res.text(); let json: { id?: string; error?: GraphError } = {};
    try { json = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }
    // A 5xx with no readable error is a Meta hiccup, not a verdict on the file: same rule as every other call, so the send is retried, not failed.
    if (!res.ok && !json.error && res.status >= 500) throw new MetaUnknownOutcome('media', `HTTP ${res.status}`);
    if (!res.ok) throw new MetaError(res.status, json.error ?? { message: `HTTP ${res.status}` }, 'media');
    if (!json.id) throw new MetaError(502, { message: 'Meta did not return a media id.' }, 'media');
    return json.id;
  }

  /** Step 1 of getting a customer's file: the media id from the webhook becomes a short-lived download link. */
  getMediaInfo(mediaId: string, token: string) { return this.request<{ id?: string; url?: string; mime_type?: string; file_size?: number }>('GET', mediaId, { token }); }

  /**
   * Step 2: download the file. The link comes from Meta's reply, so the token is only ever sent to a Meta host (or the configured test server),
   * never to an address a stranger could have put in a message. The size is checked from the headers AND while reading, so a lying server cannot fill memory.
   */
  async downloadMedia(url: string, token: string, maxBytes: number): Promise<{ bytes: Uint8Array; mime: string | null }> {
    let u: URL; try { u = new URL(url); } catch { throw new MetaError(502, { message: 'Meta sent a bad download link.' }, 'media'); }
    const base = new URL(this.cfg.baseUrl ?? 'https://graph.facebook.com');
    const metaHost = /(^|\.)(fbsbx\.com|facebook\.com|fbcdn\.net|whatsapp\.net|whatsapp\.com)$/i.test(u.hostname);
    if (!((u.protocol === 'https:' && metaHost) || u.origin === base.origin)) throw new MetaError(502, { message: 'Download link is not a Meta address.' }, 'media');
    const f = this.cfg.fetchImpl ?? fetch;
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs ?? 60_000);
    try {
      let res: Response;
      try { res = await f(u.toString(), { method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal: ctl.signal, redirect: 'error' }); }
      catch (e) { throw new MetaUnknownOutcome('media', e); }
      if (!res.ok) throw new MetaError(res.status, { message: `HTTP ${res.status}` }, 'media');
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > maxBytes) throw new MediaTooLarge(declared);
      const chunks: Uint8Array[] = []; let n = 0;
      const rd = res.body?.getReader(); if (!rd) throw new MetaError(502, { message: 'Empty download.' }, 'media');
      for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.byteLength; if (n > maxBytes) { void rd.cancel(); throw new MediaTooLarge(n); } chunks.push(value); }
      const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.byteLength; }
      return { bytes: out, mime: (res.headers.get('content-type') ?? '').split(';')[0]!.trim() || null };
    } finally { clearTimeout(timer); }
  }

  createTemplate(wabaId: string, token: string, body: unknown) { return this.request<{ id: string; status: string; category: string }>('POST', `${wabaId}/message_templates`, { token, body }); }
  listTemplates(wabaId: string, token: string, after?: string) {
    return this.request<{ data: RemoteTemplate[]; paging?: { cursors?: { after?: string }; next?: string } }>('GET', `${wabaId}/message_templates`, { token, query: { fields: 'name,status,category,language,components,quality_score', limit: 100, after } });
  }
  deleteTemplate(wabaId: string, token: string, name: string) { return this.request<{ success: boolean }>('DELETE', `${wabaId}/message_templates`, { token, query: { name } }); }
}

export interface PhoneNumber {
  id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string; status?: string; code_verification_status?: string;
  name_status?: string; account_mode?: string; platform_type?: string; is_on_biz_app?: boolean; throughput?: { level?: string };
}
export interface SendResponse { messaging_product?: string; contacts?: { input: string; wa_id?: string; user_id?: string }[]; messages?: { id: string; message_status?: 'accepted' | 'held_for_quality_assessment' | 'paused' }[] }
export interface RemoteTemplate { id?: string; name: string; status: string; category: string; language: string; components?: unknown[]; quality_score?: { score?: string } }
