import { sql } from 'drizzle-orm';
import type { Db } from '@lbc/db';

/**
 * Closes workspaces whose 30-day window has run out. Erases everything personal or confidential, keeps what the law requires.
 *
 * KEPT: the workspace row (its name and GST details), invoices, the subscription record and the audit log (so the closure itself is on record).
 * ERASED: contacts (which cascades to chats, messages, files, leads, journeys' people, consent history; a database trigger also blanks their number
 *         in campaign rows and stored webhooks), campaigns, templates and their header files, journeys, forms and lead sources, quick replies,
 *         tracked links and clicks, automation rules, connections, API keys, the WhatsApp token and number, invitations, team membership, and the
 *         sign-in accounts of people who belonged to no other workspace.
 *
 * Safe to run again after a crash: the workspace is switched to 'offboarded' first (which stops all sending and API access at once), and every
 * step only deletes, so a second pass simply finishes what was left. Each pass works on a bounded number of rows.
 */
export interface ClosureResult { due: number; closed: number; partial: number; rows: number }
const rows = (r: unknown) => r as Record<string, any>[];

/** Order matters only where a table points at another without cascade. Contacts go first: that is what carries the personal data. */
const ERASE_AFTER_CONTACTS = [
  'campaigns', 'journeys', 'automation_rules', 'quick_replies', 'tracked_links', 'link_clicks', 'lead_forms', 'lead_sources', 'lead_rejects', 'lead_events', 'lead_external_ids', 'renewals',
  'templates', 'template_assets', 'contact_groups', 'test_numbers', 'connections', 'oauth_states', 'onboarding_sessions', 'api_keys', 'invitations',
  'message_status_events', 'phone_numbers', 'meta_accounts',
] as const;

export async function closeDueWorkspaces(db: Db, opts: { batch?: number; slices?: number; tenantIds?: string[]; now?: Date } = {}): Promise<ClosureResult> {
  const slices = Math.max(1, Math.floor(Number.isFinite(Number(opts.slices)) ? Number(opts.slices) : 50));
  const batch = Math.max(100, Math.floor(Number.isFinite(Number(opts.batch)) ? Number(opts.batch) : 2000));
  const only = opts.tenantIds ? '{' + opts.tenantIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).join(',') + '}' : null;
  const now = (opts.now ?? new Date()).toISOString();
  const out: ClosureResult = { due: 0, closed: 0, partial: 0, rows: 0 };
  const due = rows(await db.execute(sql`
    select id from tenants where closed_at is null and closure_due_at is not null and closure_due_at <= ${now}::timestamptz
      and (${only}::uuid[] is null or id = any(${only}::uuid[])) order by closure_due_at limit 20`));
  out.due = due.length;
  for (const t of due) {
    const id = String(t.id);
    // Stop everything first. From here the workspace cannot send, and its API keys and tracked links stop working.
    await db.execute(sql`update tenants set status = 'offboarded', suspended_reason = 'Workspace closed at the owner''s request', updated_at = now() where id = ${id} and closed_at is null`);
    let removed = 0;
    // Contacts in bounded slices (each delete cascades a lot, and fires the number-erasing trigger per contact).
    for (let i = 0; i < slices; i++) {
      const gone = rows(await db.execute(sql`delete from contacts where id in (select id from contacts where tenant_id = ${id} limit ${batch}) returning id`)).length;
      removed += gone; if (gone < batch) break;
    }
    const left = Number(rows(await db.execute(sql`select count(*)::int as n from contacts where tenant_id = ${id}`))[0]!.n);
    if (left > 0) { out.partial++; out.rows += removed; continue; }   // more contacts than one pass could do: the rest is done next pass, and the workspace stays open to close
    // Raw webhooks are linked to a workspace by the WhatsApp ids, not by tenant_id (which Meta's events never fill). This must run BEFORE the phone numbers and
    // the account are deleted below, because they are the only link. Messages sent to us, delivery receipts and template news all go with them.
    removed += rows(await db.execute(sql`
      delete from webhook_events w where w.phone_number_id in (select phone_number_id from phone_numbers where tenant_id = ${id})
         or w.waba_id in (select messaging_account_id from meta_accounts where tenant_id = ${id}) or w.tenant_id = ${id} returning 1`)).length;
    for (const table of ERASE_AFTER_CONTACTS) {
      // Table names come from the fixed list above, never from input.
      removed += rows(await db.execute(sql.raw(`delete from "${table}" where tenant_id = '${id}' returning 1`))).length;
    }
    // People: remove them from this workspace; erase the sign-in of anyone who now belongs to no workspace at all.
    const members = rows(await db.execute(sql`delete from tenant_members where tenant_id = ${id} returning user_id`)).map((m) => String(m.user_id));
    removed += members.length;
    if (members.length) {
      removed += rows(await db.execute(sql`delete from "user" u where u.id = any(${'{' + members.join(',') + '}'}::text[]) and not exists (select 1 from tenant_members m where m.user_id = u.id) and not exists (select 1 from platform_admins a where a.user_id = u.id) returning id`)).length;
    }
    await db.execute(sql`insert into audit_log (tenant_id, actor_type, action, entity, entity_id, after) values (${id}, 'system', 'workspace.closed', 'tenant', ${id}, ${JSON.stringify({ erasedRows: removed })}::jsonb)`);
    await db.execute(sql`update tenants set closed_at = now(), updated_at = now() where id = ${id}`);
    out.closed++; out.rows += removed;
  }
  return out;
}
