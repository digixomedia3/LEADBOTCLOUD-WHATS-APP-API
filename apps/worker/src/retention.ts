import { sql } from 'drizzle-orm';
import type { Db } from '@lbc/db';

/**
 * Keeps the database from growing without end. Runs from the worker on a timer; each pass removes at most `batch` rows of each kind,
 * so a big backlog is worked off over several passes and never holds a long lock.
 *  - customer files: bytes removed after `days` (row kept as 'expired' so the chat can say so);
 *  - files we sent: removed after `days`;
 *  - template header files nobody attached to a template: removed after 1 day (a person abandoned the builder);
 *  - files that never downloaded (pending/failed) hold no bytes, so they are only marked expired with the rest.
 * Nothing here ever touches a message's text.
 */
export interface RetentionResult { inbound: number; sent: number; orphanHeaders: number }
const rows = (r: unknown) => r as Record<string, any>[];

/** `tenantIds` limits a pass to those workspaces. Production never sets it; tests always do, so a test can never touch anyone else's files. */
export async function runRetention(db: Db, opts: { days?: number; batch?: number; tenantIds?: string[] } = {}): Promise<RetentionResult> {
  // Never less than a week, whatever the setting. A value that is not a number (a typo in the environment) means the default, not a crash.
  const asked = Number(opts.days ?? 90);
  const days = Number.isFinite(asked) ? Math.max(7, Math.floor(asked)) : 90;
  const asked2 = Number(opts.batch ?? 500);
  const batch = Number.isFinite(asked2) ? Math.max(1, Math.floor(asked2)) : 500;
  const only = opts.tenantIds ? '{' + opts.tenantIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).join(',') + '}' : null;
  const inbound = rows(await db.execute(sql`
    update inbound_media set state = 'expired', data = null, error = null
    where id in (select id from inbound_media where (${only}::uuid[] is null or tenant_id = any(${only}::uuid[])) and state in ('stored','pending','failed','too_large') and created_at < now() - (${days} || ' days')::interval order by created_at limit ${batch} for update skip locked)
    returning id`)).length;
  const sent = rows(await db.execute(sql`
    delete from message_attachments
    where id in (select id from message_attachments where (${only}::uuid[] is null or tenant_id = any(${only}::uuid[])) and created_at < now() - (${days} || ' days')::interval order by created_at limit ${batch} for update skip locked)
    returning id`)).length;
  const orphanHeaders = rows(await db.execute(sql`
    delete from template_assets
    where id in (select id from template_assets where (${only}::uuid[] is null or tenant_id = any(${only}::uuid[])) and template_id is null and created_at < now() - interval '1 day' order by created_at limit ${batch} for update skip locked)
    returning id`)).length;
  return { inbound, sent, orphanHeaders };
}
