import { sql, type SQL } from 'drizzle-orm';
import { parseSegmentFilter, type SegmentRule } from '@lbc/shared';

/** SQL for one rule about a contact aliased `c`. Every subquery is pinned to the contact's own tenant, so a rule that names another workspace's id matches nobody (the worker role bypasses RLS, so this must hold in SQL itself). */
export function ruleSql(r: SegmentRule): SQL {
  switch (r.type) {
    case 'tag': return r.op === 'has' ? sql`${r.value} = any(c.tags)` : sql`not (${r.value} = any(c.tags))`;
    case 'lead_status': {
      const lit = '{' + r.values.join(',') + '}';
      const has = sql`exists (select 1 from leads l where l.contact_id = c.id and l.tenant_id = c.tenant_id and l.status = any(${lit}::text[]))`;
      return r.op === 'is' ? has : sql`not ${has}`;
    }
    case 'lead_source': {
      const has = sql`exists (select 1 from leads l where l.contact_id = c.id and l.tenant_id = c.tenant_id and l.source_id = ${r.sourceId}::uuid)`;
      return r.op === 'is' ? has : sql`not ${has}`;
    }
    case 'last_inbound':
      if (r.op === 'never') return sql`c.last_inbound_at is null`;
      if (!r.days) return sql`false`; // can't happen after parsing; fail closed rather than guess
      return r.op === 'within' ? sql`(c.last_inbound_at is not null and c.last_inbound_at >= now() - make_interval(days => ${r.days}))` : sql`(c.last_inbound_at is null or c.last_inbound_at < now() - make_interval(days => ${r.days}))`;
    case 'added':
      return r.op === 'within' ? sql`c.created_at >= now() - make_interval(days => ${r.days})` : sql`c.created_at < now() - make_interval(days => ${r.days})`;
    case 'campaign': {
      // Clicks live on a separate table. A click only counts if it was a person (not a link-preview robot), and every table is pinned to the contact's own workspace.
      const clicked = sql`exists (select 1 from campaign_recipients x join tracked_links l on l.campaign_recipient_id = x.id and l.tenant_id = c.tenant_id join link_clicks k on k.code = l.code and k.tenant_id = c.tenant_id and k.is_bot = false where x.contact_id = c.id and x.tenant_id = c.tenant_id and x.campaign_id = ${r.campaignId}::uuid)`;
      if (r.op === 'clicked') return clicked;
      if (r.op === 'not_clicked') return sql`(exists (select 1 from campaign_recipients x where x.contact_id = c.id and x.tenant_id = c.tenant_id and x.campaign_id = ${r.campaignId}::uuid and x.state = any('{sent,delivered,read,replied}'::text[])) and not ${clicked})`;
      const states: Record<Exclude<typeof r.op, 'clicked' | 'not_clicked'>, string> = { received: '{sent,delivered,read,replied}', read: '{read,replied}', replied: '{replied}', not_read: '{sent,delivered}', not_replied: '{sent,delivered,read}', failed: '{failed}' };
      return sql`exists (select 1 from campaign_recipients x where x.contact_id = c.id and x.tenant_id = c.tenant_id and x.campaign_id = ${r.campaignId}::uuid and x.state = any(${states[r.op]}::text[]))`;
    }
  }
}

export interface GroupRef { id: string; kind: string; filter: unknown }

/**
 * The "who is in these groups" condition for a contact aliased `c`, covering fixed groups and saved segments together.
 * A segment whose stored rules cannot be read contributes NOBODY (never everybody).
 */
export function audienceWhere(tenantId: string, groups: GroupRef[]): SQL {
  const staticIds = groups.filter((g) => g.kind !== 'smart' && /^[0-9a-f-]{36}$/i.test(g.id)).map((g) => g.id);
  const parts: SQL[] = [];
  if (staticIds.length) parts.push(sql`c.id in (select m.contact_id from contact_group_members m where m.tenant_id = ${tenantId}::uuid and m.group_id = any(${'{' + staticIds.join(',') + '}'}::uuid[]))`);
  for (const g of groups.filter((x) => x.kind === 'smart')) {
    const f = parseSegmentFilter(g.filter);
    if (!f) continue;
    const rules = f.rules.map(ruleSql);
    parts.push(sql`(${sql.join(rules, f.match === 'all' ? sql` and ` : sql` or `)})`);
  }
  return parts.length ? sql`(${sql.join(parts, sql` or `)})` : sql`false`;
}

/** Reads the chosen groups (id, kind, rules) for ONE workspace. Ids from another workspace simply do not come back. */
export async function loadGroups(db: { execute: (q: SQL) => Promise<unknown> }, tenantId: string, ids: string[]): Promise<GroupRef[]> {
  const lit = '{' + ids.filter((g) => /^[0-9a-f-]{36}$/i.test(g)).join(',') + '}';
  return (await db.execute(sql`select id, kind, filter from contact_groups where tenant_id = ${tenantId}::uuid and id = any(${lit}::uuid[])`)) as unknown as GroupRef[];
}
