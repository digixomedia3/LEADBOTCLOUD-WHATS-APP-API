'use server';

import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { audienceWhere, contactGroups } from '@lbc/db';
import { campaignRecipientsFor, RESULT_FILTERS, type ResultFilter } from '@/lib/core/campaign-report';
import { Forbidden, assertRole, audit, db, requireCtx } from '@/lib/session';

export async function loadRecipients(id: string, filter: ResultFilter, page: number) {
  const ctx = await requireCtx();
  if (!(RESULT_FILTERS as readonly string[]).includes(filter)) return null;
  const r = await campaignRecipientsFor(ctx, id, filter, page);
  return r.ok ? r.data : null;
}

const RETARGET_OPS = ['not_read', 'not_replied', 'read', 'replied', 'clicked', 'not_clicked', 'failed'] as const;
export type RetargetOp = (typeof RETARGET_OPS)[number];
const RETARGET_LABEL: Record<RetargetOp, string> = { not_read: 'did not read', not_replied: 'did not reply', read: 'read', replied: 'replied', clicked: 'clicked', not_clicked: 'did not click', failed: 'not delivered' };

/**
 * One click from a report: save "people from this campaign who ..." as a segment, ready to pick in the next campaign.
 * It only chooses who to consider. Permission is checked again when that campaign is created and again when it is sent.
 */
export async function retargetFrom(campaignId: string, op: RetargetOp): Promise<{ ok: true; name: string; groupId: string; people: number } | { ok: false; error: string }> {
  const ctx = await requireCtx();
  try { assertRole(ctx, 'admin'); } catch (e) { if (e instanceof Forbidden) return { ok: false, error: 'Only the owner or an admin can create groups.' }; throw e; }
  if (!(RETARGET_OPS as readonly string[]).includes(op)) return { ok: false, error: 'Choose one of the listed options.' };
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return { ok: false, error: 'That campaign id is not valid.' };
  return db(ctx, async (tx) => {
    const [c] = (await tx.execute(sql`select name, link_url from campaigns where id = ${campaignId}::uuid`)) as unknown as { name: string; link_url: string | null }[];
    if (!c) return { ok: false as const, error: 'That campaign was not found.' };
    if ((op === 'clicked' || op === 'not_clicked') && !c.link_url) return { ok: false as const, error: 'This campaign had no tracked link, so there are no clicks to use.' };
    const base = `Retarget: ${c.name.slice(0, 40)} – ${RETARGET_LABEL[op]}`.slice(0, 78);
    // Same wording twice is fine: a second click makes "… (2)" instead of failing, because groups need unique names.
    let name = base, n = 1;
    while (((await tx.execute(sql`select 1 from contact_groups where name = ${name} limit 1`)) as unknown as unknown[]).length) { n += 1; name = `${base} (${n})`.slice(0, 80); if (n > 50) return { ok: false as const, error: 'You already have many groups like this. Delete an old one first.' }; }
    const filter = { match: 'all' as const, rules: [{ type: 'campaign' as const, op, campaignId }] };
    const [row] = await tx.insert(contactGroups).values({ tenantId: ctx.tenantId, name, kind: 'smart', filter, createdBy: ctx.user.id }).returning({ id: contactGroups.id });
    const where = audienceWhere(ctx.tenantId, [{ id: 'preview', kind: 'smart', filter }]);
    const [{ n: people } = { n: 0 }] = (await tx.execute(sql`select count(*)::int as n from contacts c where ${where}`)) as unknown as { n: number }[];
    await audit(tx, 'segment.created', 'contact_group', row!.id, { from: 'campaign_report', op });
    revalidatePath('/contacts');
    return { ok: true as const, name, groupId: row!.id, people };
  });
}
