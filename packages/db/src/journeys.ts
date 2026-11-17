import { sql, type SQL } from 'drizzle-orm';

/**
 * Enrolling people into a journey. Shared by the web app (a group, by hand) and the worker (a new lead arrives).
 * Rules, all enforced here so no caller can forget them:
 *  - only an ACTIVE journey takes anyone;
 *  - someone who opted out is never enrolled;
 *  - one run per person per journey, ever (a lead who resubmits is not enrolled twice);
 *  - at most MAX_ENROLL_PER_DAY new people per journey in 24 hours, so an automatic journey cannot quietly spend a lot of money.
 * Every query is pinned to the tenant, because the worker's database role bypasses row security.
 */
export const MAX_ENROLL_PER_DAY = 500;

export interface Executor { execute: (q: SQL) => Promise<unknown> }
const rows = (r: unknown) => r as Record<string, unknown>[];

export interface EnrollResult { enrolled: number; alreadyIn: number; optedOut: number; refused: 'not_active' | 'daily_limit' | null }

export async function enrollContacts(ex: Executor, tenantId: string, journeyId: string, contactIds: string[]): Promise<EnrollResult> {
  const none: EnrollResult = { enrolled: 0, alreadyIn: 0, optedOut: 0, refused: null };
  const ids = [...new Set(contactIds)].filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) return none;
  const j = rows(await ex.execute(sql`select status from journeys where id = ${journeyId}::uuid and tenant_id = ${tenantId}::uuid`))[0];
  if (!j || j.status !== 'active') return { ...none, refused: 'not_active' };

  const today = Number(rows(await ex.execute(sql`select count(*)::int as n from journey_runs where journey_id = ${journeyId}::uuid and tenant_id = ${tenantId}::uuid and started_at > now() - interval '24 hours'`))[0]!.n);
  const room = Math.max(0, MAX_ENROLL_PER_DAY - today);
  if (room === 0) return { ...none, refused: 'daily_limit' };

  const lit = '{' + ids.join(',') + '}';
  const ok = rows(await ex.execute(sql`select id from contacts where tenant_id = ${tenantId}::uuid and id = any(${lit}::uuid[]) and consent_status <> 'stopped' order by id`)).map((r) => String(r.id));
  const optedOut = rows(await ex.execute(sql`select count(*)::int as n from contacts where tenant_id = ${tenantId}::uuid and id = any(${lit}::uuid[]) and consent_status = 'stopped'`))[0]!.n as number;
  const take = ok.slice(0, room);
  if (!take.length) return { ...none, optedOut: Number(optedOut) };

  const ins = rows(await ex.execute(sql`
    insert into journey_runs (tenant_id, journey_id, contact_id)
    select ${tenantId}::uuid, ${journeyId}::uuid, x from unnest(${'{' + take.join(',') + '}'}::uuid[]) as x
    on conflict (journey_id, contact_id) do nothing returning id`));
  return { enrolled: ins.length, alreadyIn: take.length - ins.length, optedOut: Number(optedOut), refused: ok.length > room ? 'daily_limit' : null };
}

/** A new lead arrived: put the person into every active "new lead" journey that matches the lead's source. */
export async function enrollFromLead(ex: Executor, tenantId: string, sourceId: string, contactId: string): Promise<number> {
  const js = rows(await ex.execute(sql`
    select id from journeys where tenant_id = ${tenantId}::uuid and status = 'active' and trigger->>'type' = 'lead_created'
      and (trigger->>'sourceId' is null or trigger->>'sourceId' = ${sourceId})`));
  let n = 0;
  for (const j of js) n += (await enrollContacts(ex, tenantId, String(j.id), [contactId])).enrolled;
  return n;
}

/**
 * "Start when someone gets a tag". Tags are set from many places (lead intake, imports, manual edits, other journeys), so instead of hooking each one
 * this sweeps: it finds people who carry the tag and are not in the journey yet, and enrols them through the same rules as every other way in.
 * Because a person can only ever be in a journey once, a tag that is removed and added again does not start it a second time.
 * Only a small batch per pass, so a tag on 50,000 people becomes a steady trickle bounded by the daily limit, not a flood.
 */
export const TAG_SWEEP_BATCH = 200;
export async function sweepTagJourneys(ex: Executor): Promise<{ journeys: number; enrolled: number }> {
  const js = rows(await ex.execute(sql`select id, tenant_id, trigger->>'tag' as tag from journeys where status = 'active' and trigger->>'type' = 'tag_added'`));
  let enrolled = 0;
  for (const j of js) {
    const tenantId = String(j.tenant_id), journeyId = String(j.id), tag = String(j.tag ?? '');
    if (!tag) continue;
    const ids = rows(await ex.execute(sql`
      select c.id from contacts c
      where c.tenant_id = ${tenantId}::uuid and ${tag} = any(c.tags) and c.consent_status <> 'stopped'
        and not exists (select 1 from journey_runs r where r.journey_id = ${journeyId}::uuid and r.contact_id = c.id)
      order by c.id limit ${TAG_SWEEP_BATCH}`)).map((r) => String(r.id));
    if (ids.length) enrolled += (await enrollContacts(ex, tenantId, journeyId, ids)).enrolled;
  }
  return { journeys: js.length, enrolled };
}

/** Stops every running journey for one person (used when they opt out or are removed). Returns how many were stopped. */
export async function stopRunsFor(ex: Executor, tenantId: string, contactId: string, reason: string): Promise<number> {
  return rows(await ex.execute(sql`update journey_runs set status = 'stopped', stop_reason = ${reason}, finished_at = now() where tenant_id = ${tenantId}::uuid and contact_id = ${contactId}::uuid and status = 'active' returning id`)).length;
}
