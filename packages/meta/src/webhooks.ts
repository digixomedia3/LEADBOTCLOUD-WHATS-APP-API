import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook receiver helpers (spec 5.2 to 5.5). The HTTP handler does only: verify signature on the RAW bytes, explode the payload
 * into items with a dedupe key, store, enqueue, return 200. No business logic here.
 */

/** Verify X-Hub-Signature-256 over the raw body bytes (not re-serialised JSON: Meta escapes unicode, so it would not match). */
export function verifySignature(rawBody: Buffer | string, header: string | undefined | null, appSecret: string): boolean {
  if (!header || !header.startsWith('sha256=') || !appSecret) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** GET challenge: hub.mode=subscribe and a matching verify token returns hub.challenge, otherwise 403. */
export function verifyChallenge(q: Record<string, string | undefined>, verifyToken: string): { ok: true; challenge: string } | { ok: false } {
  return q['hub.mode'] === 'subscribe' && verifyToken && q['hub.verify_token'] === verifyToken && q['hub.challenge'] ? { ok: true, challenge: q['hub.challenge'] } : { ok: false };
}

export type WebhookKind = 'message' | 'status' | 'field';
export interface WebhookItem {
  kind: WebhookKind;
  /** entry.id = WABA / Messaging account id. Routes the event to a tenant (spec 5.3). */
  wabaId: string;
  field: string;
  phoneNumberId?: string;
  /** Natural key for idempotent insert: replays are dropped by ON CONFLICT DO NOTHING. */
  dedupeKey: string;
  payload: unknown;
}

interface Entry { id?: string; changes?: { field?: string; value?: Record<string, unknown> }[] }

/** Loops entry[] -> changes[] -> messages[] / statuses[] (batching is not guaranteed). Items without a usable id are kept as whole-value items, never dropped. */
export function explodeWebhook(body: unknown): WebhookItem[] {
  const out: WebhookItem[] = [];
  const entries = (body as { entry?: Entry[] } | null)?.entry;
  if (!Array.isArray(entries)) return out;
  for (const e of entries) {
    const wabaId = String(e.id ?? '');
    for (const ch of e.changes ?? []) {
      const field = String(ch.field ?? '');
      const v = (ch.value ?? {}) as Record<string, unknown> & { metadata?: { phone_number_id?: string }; messages?: Record<string, unknown>[]; statuses?: Record<string, unknown>[] };
      const phoneNumberId = v.metadata?.phone_number_id;
      if (field === 'messages' && (Array.isArray(v.messages) || Array.isArray(v.statuses))) {
        for (const m of v.messages ?? []) out.push({ kind: 'message', wabaId, field, phoneNumberId, dedupeKey: `msg:${String(m.id ?? JSON.stringify(m))}`, payload: { ...m, _contacts: v.contacts, _metadata: v.metadata } });
        for (const s of v.statuses ?? []) out.push({ kind: 'status', wabaId, field, phoneNumberId, dedupeKey: `st:${String(s.id)}:${String(s.status)}:${String(s.timestamp ?? '')}`, payload: { ...s, _metadata: v.metadata } });
        const errs = (v as { errors?: unknown[] }).errors;
        if (Array.isArray(errs) && errs.length) out.push({ kind: 'field', wabaId, field: 'messages.errors', phoneNumberId, dedupeKey: `err:${wabaId}:${JSON.stringify(errs)}`, payload: { errors: errs } });
      } else {
        out.push({ kind: 'field', wabaId, field, phoneNumberId, dedupeKey: `f:${field}:${wabaId}:${stableHash(JSON.stringify(ch.value ?? {}))}`, payload: ch.value ?? {} });
      }
    }
  }
  return out;
}

/** Small deterministic string hash for dedupe keys of whole-value events (not security sensitive). */
export function stableHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Status rank (spec 5.4). Never downgrade; failed is terminal and overrides lower ranks. */
export const STATUS_RANK: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3, played: 4 };
export function nextStatus(current: string, incoming: string): string {
  if (current === 'failed') return 'failed';
  if (incoming === 'failed') return 'failed';
  const c = STATUS_RANK[current] ?? -1, n = STATUS_RANK[incoming] ?? -1;
  return n > c ? incoming : current;
}

/** Meta timestamps are Unix-seconds strings (spec 5.4). */
export function fromUnixSeconds(ts: string | number | undefined): Date | null {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null;
}

/** biz_opaque_callback_data = msg:<uuid> joins a status to our message row before the wamid is stored (spec 4.1/5.4). */
export function parseCallbackData(v: unknown): string | null {
  const m = typeof v === 'string' ? /^msg:([0-9a-f-]{36})$/i.exec(v) : null;
  return m ? m[1]! : null;
}

/** STOP keywords (spec 5.5; the Hindi/Hinglish entries are [INFERRED] and should be configurable per tenant). */
const STOP = /^\s*(stop|unsubscribe|opt ?out|band karo|band kar do|बंद करो|रोको)\s*[.!]?\s*$/i;
const START = /^\s*(start|subscribe|shuru karo|शुरू)\s*[.!]?\s*$/i;
export const isStopText = (t: string) => STOP.test(t);
export const isStartText = (t: string) => START.test(t);
