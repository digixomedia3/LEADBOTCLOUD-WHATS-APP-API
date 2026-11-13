import { sql } from 'drizzle-orm';
import { explodeWebhook, verifySignature, type WebhookItem } from '@lbc/meta';
import { webhookEvents, type Db } from '@lbc/db';

export interface Ingest { status: 200 | 401; stored: number; duplicates: number; items: { id: number; item: WebhookItem }[] }

/**
 * The receiver does only this (AGENTS.md rule 3, spec 5.2): verify the signature on the RAW bytes, explode into items,
 * store each with a dedupe key, hand the new ids to the queue. No business logic here.
 * A bad signature is logged as a row with signature_ok=false and is NOT processed.
 */
export async function ingestWebhook(db: Db, raw: Buffer, signatureHeader: string | undefined, appSecret: string): Promise<Ingest> {
  const ok = verifySignature(raw, signatureHeader, appSecret);
  let body: unknown = null;
  try { body = JSON.parse(raw.toString('utf8')); } catch { /* not JSON */ }

  if (!ok) {
    await db.insert(webhookEvents).values({ signatureOk: false, dedupeKey: `bad:${Date.now()}:${Math.random().toString(36).slice(2)}`, payload: { note: 'signature mismatch', bytes: raw.length } });
    return { status: 401, stored: 0, duplicates: 0, items: [] };
  }

  const items = explodeWebhook(body);
  const fresh: Ingest['items'] = [];
  let dup = 0;
  for (const item of items) {
    const rows = await db.insert(webhookEvents).values({
      signatureOk: true, wabaId: item.wabaId || null, phoneNumberId: item.phoneNumberId ?? null, field: item.field, dedupeKey: item.dedupeKey, payload: { kind: item.kind, ...(item.payload as object) },
    }).onConflictDoNothing().returning({ id: webhookEvents.id });
    if (rows[0]) fresh.push({ id: rows[0].id, item }); else dup++;
  }
  return { status: 200, stored: fresh.length, duplicates: dup, items: fresh };
}

export const markProcessed = (db: Db, id: number, error?: string) =>
  db.execute(sql`update webhook_events set processed_at = now(), process_error = ${error ?? null}, attempts = attempts + 1 where id = ${id}`);
