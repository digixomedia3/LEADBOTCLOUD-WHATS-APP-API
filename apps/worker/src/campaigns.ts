import { sql } from 'drizzle-orm';
import { audienceWhere, loadGroups, type Db } from '@lbc/db';
import { estimateCost } from '@lbc/shared';
import { isTemporaryAppUrl, isTrackedButtonValue } from '@lbc/shared/tracked-links';
import { generateLinkCode } from '@lbc/shared/link-code';
import { startTimeFor } from '@lbc/shared/send-window';

type Row = Record<string, unknown>;
const rows = (r: unknown) => r as Row[];

/** Resolves one template variable for one contact. "@name" is the first name (falls back to "there"), "@phone" the number; anything else is fixed text. */
export { resolveVar } from '@lbc/shared';
import { resolveVar as resolveVarShared } from '@lbc/shared';

export const NEXT_MS: Record<string, number> = { daily: 86_400_000, weekly: 7 * 86_400_000, monthly: 30 * 86_400_000 };

export interface LaunchResult { campaignId: string; queued: number; skipped: number; status: string; reason?: string }

/**
 * Expands a due campaign into one message per sendable contact (spec 4.5 steps 1-2). Runs inside one transaction, and the
 * 'scheduled' -> 'running' claim makes it exactly-once even with several workers. Pre-send rules that can be decided here
 * (consent, reachability, hold, spend cap) are applied now; sendOne() applies them AGAIN right before the Graph call.
 */
export async function launchCampaign(db: Db, tenantId: string, campaignId: string, appUrl?: string, strictAppUrl = true): Promise<LaunchResult> {
  return db.transaction(async (tx) => {
    const claimed = rows(await tx.execute(sql`update campaigns set status = 'running', started_at = now(), launched_at = now() where id = ${campaignId} and tenant_id = ${tenantId} and status = 'scheduled' returning *`))[0];
    if (!claimed) return { campaignId, queued: 0, skipped: 0, status: 'not_due' };
    const fail = async (reason: string, status = 'paused') => {
      await tx.execute(sql`update campaigns set status = ${status}, pause_reason = ${reason}, started_at = null where id = ${campaignId} and tenant_id = ${tenantId}`);
      return { campaignId, queued: 0, skipped: 0, status, reason };
    };

    const t = rows(await tx.execute(sql`select id, name, language, category, status, body, buttons, offer from templates where id = ${claimed.template_id} and tenant_id = ${tenantId}`))[0];
    if (!t || t.status !== 'approved') return fail('template_not_approved');
    const acc = rows(await tx.execute(sql`select token_status, health_state, payment_method_status from meta_accounts where tenant_id = ${tenantId} limit 1`))[0];
    if (!acc) return fail('not_connected');
    if (acc.token_status !== 'valid') return fail('reconnect');
    if (acc.health_state !== 'ok') return fail('account_restricted');
    if (acc.payment_method_status === 'failing') return fail('payment_banner');
    const ph = rows(await tx.execute(sql`select phone_number_id from phone_numbers where tenant_id = ${tenantId} order by created_at limit 1`))[0];
    if (!ph) return fail('not_connected');

    // An offer needs its code (if it has a copy-code button) and its end time (if it has a countdown). Both come from the campaign and are checked now.
    const hasCopy = ((t.buttons ?? []) as { type: string }[]).some((b) => b.type === 'copy_code');
    const offer = t.offer as { hasExpiration?: boolean } | null;
    if (hasCopy && !claimed.offer_code) return fail('offer_code_missing');
    // A tracked website button (APP_URL/r/{{1}}) needs a destination, and a permanent app address so the link still works next year.
    const tracked = ((t.buttons ?? []) as { type: string; value?: string }[]).some((b) => b.type === 'url' && !!appUrl && isTrackedButtonValue(b.value, appUrl));
    if (tracked) {
      if (!claimed.link_url) return fail('link_missing');
      if (!appUrl || (strictAppUrl && isTemporaryAppUrl(appUrl))) return fail('app_url_temporary');
    }
    const offerEnds = claimed.offer_expires_at ? new Date(String(claimed.offer_expires_at)).getTime() : null;
    if (offer?.hasExpiration && (!offerEnds || offerEnds <= Date.now() + 60_000)) return fail(offerEnds ? 'offer_ended' : 'offer_time_missing');

    const groupLit = '{' + (claimed.group_ids as string[]).filter((g) => /^[0-9a-f-]{36}$/i.test(g)).join(',') + '}';
    const groups = await loadGroups(tx, tenantId, claimed.group_ids as string[]);
    // Fixed groups and saved segments are read together; a segment is re-read now, at launch, so it is never stale.
    const all = rows(await tx.execute(sql`
      select c.id, c.phone_e164, c.name, c.consent_status, c.reachability, c.freq_cap_hold_until
      from contacts c where c.tenant_id = ${tenantId}::uuid and ${audienceWhere(tenantId, groups)} order by c.id`));

    const category = String(t.category);
    const reasonFor = (c: Row): string | null => {
      if (c.consent_status === 'stopped') return 'Opted out';
      if (category === 'marketing' && c.consent_status !== 'allowed') return 'No permission on record';
      if (c.reachability === 'unreachable') return 'Cannot receive WhatsApp messages';
      if (c.freq_cap_hold_until && new Date(String(c.freq_cap_hold_until)) > new Date()) return 'Meta limited promotional messages to this customer today';
      return null;
    };
    const sendable = all.filter((c) => !reasonFor(c));
    const skipped = all.filter((c) => reasonFor(c));

    // Spend cap is re-checked against the live audience, in integer paise.
    const est = estimateCost(sendable.length, category as 'marketing');
    const cap = claimed.spend_cap_paise as number | null;
    if (cap !== null && est.totalPaise > cap) return fail('spend_cap');

    const varMap = (claimed.var_map as string[]) ?? [];
    const counts = { audience: sendable.length, sent: 0, skipped: skipped.length, optedOut: all.filter((c) => c.consent_status === 'stopped').length, queued: sendable.length };

    for (const c of skipped) {
      await tx.execute(sql`insert into campaign_recipients (tenant_id, campaign_id, contact_id, phone_e164, name, state, reason) values (${tenantId}, ${campaignId}, ${c.id}, ${c.phone_e164}, ${c.name}, 'skipped', ${reasonFor(c)}) on conflict (campaign_id, contact_id) where contact_id is not null do nothing`);
    }
    const launchedAt = new Date();
    let position = 0;
    for (const c of sendable) {
      const notBefore = startTimeFor(position++, claimed.send_per_minute as number | null, launchedAt);
      const params = varMap.map((v) => resolveVarShared(String(v), { name: c.name as string | null, phone: String(c.phone_e164) }));
      const cr = rows(await tx.execute(sql`insert into campaign_recipients (tenant_id, campaign_id, contact_id, phone_e164, name, state) values (${tenantId}, ${campaignId}, ${c.id}, ${c.phone_e164}, ${c.name}, 'queued') on conflict (campaign_id, contact_id) where contact_id is not null do nothing returning id`))[0];
      if (!cr) continue; // already expanded (a retry of this function): never create a second message
      let linkCode: string | undefined;
      if (tracked) {
        // One code per person. A collision is astronomically unlikely, but the primary key would refuse it and the whole launch would roll back and retry.
        linkCode = generateLinkCode();
        await tx.execute(sql`insert into tracked_links (code, tenant_id, campaign_id, campaign_recipient_id) values (${linkCode}, ${tenantId}, ${campaignId}, ${cr.id})`);
      }
      const conv = rows(await tx.execute(sql`insert into conversations (tenant_id, contact_id, phone_number_id, status, unread) values (${tenantId}, ${c.id}, ${ph.phone_number_id}, 'open', 0) on conflict (tenant_id, contact_id) do update set phone_number_id = coalesce(conversations.phone_number_id, excluded.phone_number_id) returning id`))[0]!;
      await tx.execute(sql`insert into messages (tenant_id, conversation_id, direction, kind, body, status, template_name, template_language, template_category, payload, phone_number_id, campaign_recipient_id, not_before)
        values (${tenantId}, ${conv.id}, 'out', 'template', ${t.name}, 'queued', ${t.name}, ${t.language}, ${category}, ${JSON.stringify({ params, ...(linkCode ? { linkCode } : {}), ...(claimed.offer_code ? { code: claimed.offer_code } : {}), ...(offer?.hasExpiration && offerEnds ? { offerExpiresMs: offerEnds } : {}) })}::jsonb, ${ph.phone_number_id}, ${cr.id}, ${notBefore.getTime() > launchedAt.getTime() ? notBefore.toISOString() : null}::timestamptz)`);
    }
    await tx.execute(sql`update campaigns set counts = ${JSON.stringify(counts)}::jsonb, est_cost_paise = ${est.totalPaise} where id = ${campaignId} and tenant_id = ${tenantId}`);

    // Repeat: schedule the next run now, so a crash later cannot lose it.
    const step = NEXT_MS[String(claimed.repeat)];
    if (step) {
      const base = claimed.scheduled_at ? new Date(String(claimed.scheduled_at)) : new Date();
      await tx.execute(sql`insert into campaigns (tenant_id, name, template_id, group_ids, status, scheduled_at, repeat, spend_cap_paise, var_map, send_policy, created_by, offer_code, offer_expires_at, link_url, send_per_minute)
        values (${tenantId}, ${claimed.name}, ${claimed.template_id}, ${groupLit}::uuid[], 'scheduled', ${new Date(base.getTime() + step).toISOString()}::timestamptz, ${claimed.repeat}, ${cap}, ${JSON.stringify(varMap)}::jsonb, ${claimed.send_policy}, ${claimed.created_by}, ${claimed.offer_code ?? null}, ${claimed.offer_expires_at ? new Date(String(claimed.offer_expires_at)).toISOString() : null}::timestamptz, ${claimed.link_url ?? null}, ${claimed.send_per_minute ?? null})`);
    }
    return { campaignId, queued: sendable.length, skipped: skipped.length, status: 'running' };
  });
}

/** Campaigns whose time has come. */
export async function dueCampaigns(db: Db, limit = 50) {
  return rows(await db.execute(sql`select id, tenant_id from campaigns where status = 'scheduled' and coalesce(scheduled_at, now()) <= now() order by scheduled_at nulls first limit ${limit}`)) as { id: string; tenant_id: string }[];
}

/** Messages of a running campaign that still need queueing (the sweeper in main.ts also covers this, but a launch enqueues straight away). */
export async function queuedMessageIds(db: Db, tenantId: string, campaignId: string) {
  return rows(await db.execute(sql`select m.id from messages m join campaign_recipients r on r.id = m.campaign_recipient_id where r.campaign_id = ${campaignId} and m.tenant_id = ${tenantId} and m.status = 'queued' and m.wamid is null`)).map((r) => String(r.id));
}

/**
 * Recomputes counts from the recipients and closes a campaign once nothing is waiting. Counts come from the data, never from
 * increments, so a replayed or reordered webhook cannot make them drift. Also refreshes recently completed campaigns,
 * because delivered / read receipts keep arriving after the last send.
 */
export async function rollupCampaigns(db: Db): Promise<number> {
  const open = rows(await db.execute(sql`select id, tenant_id, status from campaigns where status = 'running' or (status = 'completed' and completed_at > now() - interval '3 days')`));
  for (const c of open) {
    const r = rows(await db.execute(sql`
      select count(*) filter (where state not in ('skipped'))::int audience,
             count(*) filter (where state in ('sent','delivered','read','replied'))::int sent,
             count(*) filter (where state in ('delivered','read','replied'))::int delivered,
             count(*) filter (where state in ('read','replied'))::int read,
             count(*) filter (where state = 'replied')::int replied,
             count(*) filter (where state = 'failed')::int failed,
             count(*) filter (where state = 'capped')::int capped,
             count(*) filter (where state = 'skipped')::int skipped,
             count(*) filter (where state = 'skipped' and reason = 'Opted out')::int opted_out,
             count(*) filter (where state in ('queued','retry_wait'))::int waiting
      from campaign_recipients where campaign_id = ${c.id} and tenant_id = ${c.tenant_id}`))[0]!;
    const counts = { audience: r.audience, sent: r.sent, delivered: r.delivered, read: r.read, replied: r.replied, failed: r.failed, capped: r.capped, skipped: r.skipped, optedOut: r.opted_out };
    // 'sent' counted any message Meta accepted; messages that failed after acceptance are in failed, so sent excludes them already.
    const done = c.status === 'running' && Number(r.waiting) === 0;
    await db.execute(sql`update campaigns set counts = ${JSON.stringify(counts)}::jsonb, status = ${done ? 'completed' : c.status}, completed_at = case when ${done} then now() else completed_at end where id = ${c.id} and tenant_id = ${c.tenant_id}`);
  }
  return open.length;
}
