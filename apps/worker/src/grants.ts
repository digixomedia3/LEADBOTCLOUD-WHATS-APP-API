import { sql } from 'drizzle-orm';
import type { Db } from '@lbc/db';

type Row = Record<string, unknown>;
const rows = (r: unknown) => r as Row[];

export interface GrantExpiryResult { expired: number }

/**
 * Ends complimentary plans whose time has run out. Staff grant a plan for a number of days; this puts the workspace back to what it really pays for
 * (free, if nothing). Runs every minute. Safe to run twice or from several workers: the row is cleared in the same statement that picks it, so each grant
 * ends once, and the plan is recomputed by the database's own rule (effective_plan), never guessed here. Data is never deleted; only limits change.
 */
export async function expireGrants(db: Db, opts: { limit?: number } = {}): Promise<GrantExpiryResult> {
  // A bad number (NaN, a string from a config) must not reach the database: fall back to 100, then keep it within 1 to 500.
  const asked = Number(opts.limit ?? 100);
  const limit = Math.max(1, Math.min(500, Math.floor(Number.isFinite(asked) ? asked : 100)));
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    // Claim: clear the grant and return what it was, in one statement. Two workers cannot both get the same row.
    const gone = rows(await t.execute(sql`
      with due as (select id from tenants where comp_plan is not null and comp_until <= now() order by comp_until limit ${limit} for update skip locked)
      update tenants x set comp_plan = null, comp_until = null, comp_reason = null, comp_granted_by = null, comp_granted_at = null
      from due, tenants old where x.id = due.id and old.id = x.id
      returning x.id, old.comp_plan as was, old.comp_until as was_until, old.plan_id as before`));
    for (const g of gone) {
      const now = rows(await t.execute(sql`update tenants set plan_id = public.effective_plan(${g.id}::uuid), updated_at = now() where id = ${g.id} returning plan_id`))[0]!;
      await t.execute(sql`insert into audit_log (tenant_id, actor_type, action, entity, entity_id, after) values (${g.id}, 'system', 'billing.grant_expired', 'tenant', ${String(g.id)}, ${JSON.stringify({ plan: g.was, wasUntil: g.was_until, now: now.plan_id })}::jsonb)`);
    }
    return { expired: gone.length };
  });
}
