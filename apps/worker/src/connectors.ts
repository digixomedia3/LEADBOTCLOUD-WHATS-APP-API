import { sql } from 'drizzle-orm';
import type { Db } from '@lbc/db';
import {
  ConnectorError, freshGoogleToken, metaLeadToPayload, parseLeadgenWebhook, shopifyToPayload, verifyShopifyWebhook,
  type GoogleClient, type MetaLeadsClient,
} from '@lbc/connectors';
import { decryptSecret, encryptSecret } from '@lbc/meta';
import { ingestForSource } from './leads';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const rows = async (db: Db, q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as Row[];

/**
 * Connector events follow the same contract as billing and Meta webhooks: the receiver verifies, stores with a dedupe key and answers 200;
 * a separate loop does the work. A crash between the two loses nothing, because unprocessed rows are picked up again.
 */
export interface ConnectorIngest { status: 200 | 401 | 503; ids: number[] }
const MAX_ATTEMPTS = 6;

async function store(db: Db, provider: string, dedupe: string, ok: boolean, topic: string | null, externalId: string | null, payload: unknown): Promise<number | null> {
  const r = await rows(db, sql`insert into connector_events (provider, dedupe_key, signature_ok, topic, external_id, payload) values (${provider}, ${dedupe}, ${ok}, ${topic}, ${externalId}, ${JSON.stringify(payload)}::jsonb)
    on conflict (dedupe_key) do nothing returning id`);
  return r[0] ? Number(r[0].id) : null;
}

/** Shopify signs the raw body with the app's client secret (base64 HMAC-SHA256 in X-Shopify-Hmac-Sha256). A bad signature is recorded and never processed. */
export async function ingestShopify(db: Db, raw: Buffer, h: Record<string, string | string[] | undefined>, secret: string | undefined): Promise<ConnectorIngest> {
  if (!secret) return { status: 503, ids: [] };
  const hdr = (k: string) => { const v = h[k]; return Array.isArray(v) ? v[0] : v; };
  if (!verifyShopifyWebhook(raw, hdr('x-shopify-hmac-sha256'), secret)) {
    await store(db, 'shopify', `bad:${Date.now()}:${Math.random().toString(36).slice(2)}`, false, null, null, { note: 'signature mismatch', bytes: raw.length });
    return { status: 401, ids: [] };
  }
  let body: unknown = null;
  try { body = JSON.parse(raw.toString('utf8')); } catch { /* handled below */ }
  const shop = (hdr('x-shopify-shop-domain') ?? '').toLowerCase(), topic = hdr('x-shopify-topic') ?? '';
  const eventId = hdr('x-shopify-event-id') ?? hdr('x-shopify-webhook-id') ?? `${topic}:${shop}:${(body as Row | null)?.id ?? raw.length}`;
  if (!body || typeof body !== 'object' || !shop || !topic) return { status: 200, ids: [] };
  const id = await store(db, 'shopify', `shopify:${shop}:${eventId}`, true, topic, shop, { shop, topic, body });
  return { status: 200, ids: id === null ? [] : [id] };
}

/** Facebook sends only ids (page, form, leadgen); the lead itself is fetched later with the Page token. Signature is checked by the caller with the same function as Meta's other webhooks. */
export async function ingestMetaLeadgen(db: Db, body: unknown): Promise<number[]> {
  const out: number[] = [];
  for (const e of parseLeadgenWebhook(body)) {
    const id = await store(db, 'meta_lead_ads', `meta:lead:${e.leadgenId}`, true, 'leadgen', e.pageId, e);
    if (id !== null) out.push(id);
  }
  return out;
}

async function markConn(db: Db, id: string, patch: { error?: string | null; needsReauth?: boolean; synced?: boolean }) {
  await db.execute(sql`update connections set last_error = ${patch.error ?? null}, status = case when ${patch.needsReauth === true} then 'needs_reauth' else status end,
    last_sync_at = case when ${patch.synced === true} then now() else last_sync_at end, updated_at = now() where id = ${id}`);
}

export interface Deps { db: Db; tokenKey: string; meta?: MetaLeadsClient | undefined; google?: GoogleClient | undefined }
type Outcome = { done: true; error?: string } | { done: false; error: string };

async function sourceFor(db: Db, conn: Row): Promise<Row | null> {
  if (!conn.source_id) return null;
  return (await rows(db, sql`select * from lead_sources where id = ${conn.source_id}`))[0] ?? null;
}

async function handleShopify(d: Deps, ev: Row): Promise<Outcome> {
  const { shop, topic, body } = ev.payload as { shop: string; topic: string; body: Row };
  const conn = (await rows(d.db, sql`select * from connections where provider = 'shopify' and external_id = ${shop}`))[0];
  if (!conn) return { done: true, error: 'no_connection' };
  if (topic === 'app/uninstalled') {
    await d.db.execute(sql`update connections set status = 'needs_reauth', access_token_enc = null, refresh_token_enc = null, last_error = 'The store removed the app.', updated_at = now() where id = ${conn.id}`);
    if (conn.source_id) await d.db.execute(sql`update lead_sources set enabled = false, updated_at = now() where id = ${conn.source_id}`);
    return { done: true };
  }
  const src = await sourceFor(d.db, conn);
  if (!src || !src.enabled) return { done: true, error: 'source_off' };
  const payload = shopifyToPayload(topic, body);
  if (!payload) return { done: true, error: 'no_id' };
  const r = await ingestForSource(d.db, src, Buffer.from(JSON.stringify(payload)), 'application/json');
  await markConn(d.db, conn.id, { synced: true });
  return r.status === 200 ? { done: true } : { done: true, error: `lead_${r.status}` };
}

async function handleMeta(d: Deps, ev: Row): Promise<Outcome> {
  if (!d.meta) return { done: false, error: 'Facebook app is not configured on this server.' };
  const e = ev.payload as { pageId: string; leadgenId: string };
  const conn = (await rows(d.db, sql`select * from connections where provider = 'meta_lead_ads' and external_id = ${e.pageId}`))[0];
  if (!conn) return { done: true, error: 'no_connection' };
  if (conn.status !== 'active' || !conn.access_token_enc) return { done: true, error: 'needs_reauth' };
  const src = await sourceFor(d.db, conn);
  if (!src || !src.enabled) return { done: true, error: 'source_off' };
  try {
    const lead = await d.meta.getLead(e.leadgenId, decryptSecret(conn.access_token_enc, d.tokenKey));
    const r = await ingestForSource(d.db, src, Buffer.from(JSON.stringify(metaLeadToPayload(lead))), 'application/json');
    await markConn(d.db, conn.id, { synced: true });
    return r.status === 200 ? { done: true } : { done: true, error: `lead_${r.status}` };
  } catch (err) {
    if (err instanceof ConnectorError && err.needsReauth) { await markConn(d.db, conn.id, { error: 'Facebook access expired. Connect the Page again.', needsReauth: true }); return { done: true, error: 'needs_reauth' }; }
    if (err instanceof ConnectorError && !err.retryable) { await markConn(d.db, conn.id, { error: err.message.slice(0, 200) }); return { done: true, error: `facebook_${err.code ?? err.status}` }; }
    return { done: false, error: (err as Error).message.slice(0, 200) };
  }
}

/**
 * Takes one event if nobody else has it. The claim is a single atomic UPDATE that sets a lease: a second worker (or a second tick) finds the lease
 * held and skips. A crashed worker's lease simply runs out after a minute, and the event is picked up again.
 */
export async function processConnectorEvent(d: Deps, id: number): Promise<'done' | 'retry' | 'skipped'> {
  const claimed = await rows(d.db, sql`update connector_events set claimed_at = now(), attempts = attempts + 1
    where id = ${id} and processed_at is null and signature_ok and (claimed_at is null or claimed_at < now() - interval '60 seconds') returning *`);
  const ev = claimed[0];
  if (!ev) return 'skipped';
  let o: Outcome;
  try { o = ev.provider === 'shopify' ? await handleShopify(d, ev) : ev.provider === 'meta_lead_ads' ? await handleMeta(d, ev) : { done: true, error: 'unknown_provider' }; }
  catch (err) { o = { done: false, error: (err as Error).message.slice(0, 200) }; }
  if (o.done || ev.attempts >= MAX_ATTEMPTS) {
    await d.db.execute(sql`update connector_events set processed_at = now(), claimed_at = null, process_error = ${o.error ?? null} where id = ${id}`);
    return 'done';
  }
  await d.db.execute(sql`update connector_events set claimed_at = null, process_error = ${o.error} where id = ${id}`);
  return 'retry';
}

/** Rows that were stored but never finished (crash, outage). Waits longer after each failure. */
export async function pendingConnectorEvents(db: Db, limit = 25): Promise<number[]> {
  const r = await rows(db, sql`select id from connector_events where processed_at is null and signature_ok and attempts < ${MAX_ATTEMPTS} and (claimed_at is null or claimed_at < now() - interval '60 seconds')
    and received_at < now() - (least(attempts, 5) * interval '15 seconds') order by id limit ${limit}`);
  return r.map((x) => Number(x.id));
}

/* ---------------------------------------------------------------------------------------------------------------- Google Sheets (polled) */
export interface SheetsReport { connections: number; rows: number; created: number; errors: number }
const ROW_CAP = 500;

/**
 * Reads new rows from each connected sheet. The header row names the columns. `config.nextRow` remembers where we stopped, and each row also
 * carries a stable external id (sheet + row number), so even if that bookmark is lost a re-read changes nothing.
 */
export async function syncSheets(d: Deps): Promise<SheetsReport> {
  const rep: SheetsReport = { connections: 0, rows: 0, created: 0, errors: 0 };
  if (!d.google) return rep;
  const conns = await rows(d.db, sql`select * from connections where provider = 'google_sheets' and status = 'active' and access_token_enc is not null and config ? 'spreadsheetId'`);
  for (const c of conns) {
    rep.connections++;
    try {
      const src = await sourceFor(d.db, c);
      if (!src || !src.enabled) continue;
      const cfg = c.config as { spreadsheetId: string; sheet?: string; nextRow?: number };
      const tab = cfg.sheet && /^[\w .-]{1,60}$/.test(cfg.sheet) ? cfg.sheet : 'Sheet1';
      const cur = { accessToken: decryptSecret(c.access_token_enc, d.tokenKey), refreshToken: c.refresh_token_enc ? decryptSecret(c.refresh_token_enc, d.tokenKey) : null, expiresAt: c.token_expires_at ? new Date(c.token_expires_at) : null };
      const { token, refreshed } = await freshGoogleToken(d.google, cur);
      if (refreshed) await d.db.execute(sql`update connections set access_token_enc = ${encryptSecret(refreshed.accessToken, d.tokenKey)}, token_expires_at = ${refreshed.expiresAt?.toISOString() ?? null}::timestamptz, updated_at = now() where id = ${c.id}`);
      const start = Math.max(2, Math.floor(cfg.nextRow ?? 2));
      const head = (await d.google.values(cfg.spreadsheetId, `${tab}!1:1`, token))[0] ?? [];
      const data = await d.google.values(cfg.spreadsheetId, `${tab}!${start}:${start + ROW_CAP - 1}`, token);
      let last = start - 1;
      for (let i = 0; i < data.length; i++) {
        const row = data[i]!, n = start + i;
        last = n;
        if (row.every((v) => !String(v).trim())) continue;
        const obj: Record<string, string> = {};
        head.forEach((h, k) => { if (h.trim() && row[k] !== undefined && String(row[k]).trim()) obj[h.trim()] = String(row[k]); });
        obj.external_id = `sheet:${cfg.spreadsheetId}:${tab}:${n}`;
        rep.rows++;
        const r = await ingestForSource(d.db, src, Buffer.from(JSON.stringify(obj)), 'application/json');
        if (r.status === 200 && r.created) rep.created++;
      }
      await d.db.execute(sql`update connections set config = jsonb_set(config, '{nextRow}', to_jsonb(${last + 1}::int)), last_sync_at = now(), last_error = null, updated_at = now() where id = ${c.id}`);
    } catch (err) {
      rep.errors++;
      if (err instanceof ConnectorError && err.needsReauth) await markConn(d.db, c.id, { error: 'Google access was removed. Connect the sheet again.', needsReauth: true });
      else await markConn(d.db, c.id, { error: (err as Error).message.slice(0, 200) });
    }
  }
  return rep;
}
