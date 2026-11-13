import { sql } from 'drizzle-orm';
import type { Db } from '@lbc/db';
import { handleAccountUpdate, handleInbound, handleStatus, handleTemplateStatus, routeTenant, type Outcome } from './handlers';

/**
 * Takes one stored webhook_events row and runs the right handler. Dispatch is by the Graph `field` for whole-value events
 * (message_template_status_update, account_update, ...) and by `kind` for exploded message / status items.
 * Anything it does not recognise is stored as 'ignored' with a note, never guessed at (AGENTS.md rule 2).
 */
export async function processEvent(db: Db, row: Record<string, any>, attemptsMade: number): Promise<Outcome | 'done'> {
  if (!row || row.processed_at) return 'done';
  const payload = (row.payload ?? {}) as Record<string, any>;
  const route = await routeTenant(db, row.waba_id, row.phone_number_id);
  const mark = (error?: string) => db.execute(sql`update webhook_events set processed_at = now(), process_error = ${error ?? null}, attempts = attempts + 1 where id = ${row.id}`);
  if (route === 'unknown' || route === 'mismatch') { await mark(route === 'unknown' ? 'unrouted: unknown WABA' : 'quarantined: phone number does not belong to this tenant'); return route === 'unknown' ? 'unrouted' : 'quarantined'; }

  let out: Outcome = 'ignored';
  const field = String(row.field ?? '');
  if (payload.kind === 'status') out = await handleStatus(db, route.tenantId, payload as never, attemptsMade);
  else if (payload.kind === 'message') out = (await handleInbound(db, route.tenantId, row.phone_number_id, payload as never)).outcome;
  else if (field === 'message_template_status_update') out = await handleTemplateStatus(db, route.tenantId, payload as never);
  else if (field === 'account_update') out = await handleAccountUpdate(db, route.tenantId, payload as never);

  if (out === 'orphan_retry') throw new Error('message not found yet; will retry'); // BullMQ backs off, then the next try gives up
  await mark(out === 'ignored' ? `ignored: ${field || payload.kind || 'unknown'}` : undefined);
  return out;
}
