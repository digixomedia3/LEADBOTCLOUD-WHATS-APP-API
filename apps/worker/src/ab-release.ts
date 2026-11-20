import { sql } from 'drizzle-orm';
import type { Db } from '@lbc/db';
import { estimateCost, resolveVar } from '@lbc/shared';
import { generateLinkCode } from '@lbc/shared/link-code';
import { isTemporaryAppUrl, isTrackedButtonValue } from '@lbc/shared/tracked-links';
import { startTimeFor } from '@lbc/shared/send-window';
import { skipReason } from './campaigns';

type Row = Record<string, unknown>;
const rows = (r: unknown) => r as Row[];

export interface ReleaseResult { campaignId: string; status: 'released' | 'refused' | 'nothing_to_do'; reason?: string; queued: number; skipped: number }

/** Plain reasons shown to the owner when a release could not go ahead. */
export { RELEASE_REASONS } from '@lbc/shared/release-reasons';

/**
 * Sends the chosen version to the people who were held back at launch. Exactly once (the claim on ab_released_at), and every safety rule is checked again NOW,
 * not as it was at launch: a person who has since opted out, or whose number turned out not to work, is skipped with the reason written down, and an offer that
 * ended or a token that expired stops the whole release with a plain message the owner can act on. Nothing is half-done: either all held people are queued or none.
 */
export async function releaseWinner(db: Db, tenantId: string, campaignId: string, appUrl?: string, strictAppUrl = true): Promise<ReleaseResult> {
  return db.transaction(async (tx) => {
    // The claim. Only one worker can win this update, and only while a version has been chosen and nothing has been released yet.
    const c = rows(await tx.execute(sql`update campaigns set ab_released_at = now(), ab_release_error = null where id = ${campaignId} and tenant_id = ${tenantId} and ab_hold_rest = true and ab_release_version is not null and ab_released_at is null and status in ('completed','running') returning *`))[0];
    if (!c) return { campaignId, status: 'nothing_to_do' as const, queued: 0, skipped: 0 };
    const refuse = async (reason: string) => {
      // Undo the claim so the owner can fix the cause and ask again. The chosen version is cleared so the screen shows the button again with the message.
      await tx.execute(sql`update campaigns set ab_released_at = null, ab_release_version = null, ab_release_requested_at = null, ab_release_requested_by = null, ab_release_error = ${reason} where id = ${campaignId} and tenant_id = ${tenantId}`);
      return { campaignId, status: 'refused' as const, reason, queued: 0, skipped: 0 };
    };

    const useB = c.ab_release_version === 'b';
    const tplId = useB ? c.ab_template_id : c.template_id;
    const t = rows(await tx.execute(sql`select id, name, language, category, status, buttons, offer from templates where id = ${tplId} and tenant_id = ${tenantId}`))[0];
    if (!t || t.status !== 'approved') return refuse('template_not_approved');
    const varMap = ((useB ? c.ab_var_map : c.var_map) as string[] | null) ?? [];

    const acc = rows(await tx.execute(sql`select token_status, health_state, payment_method_status from meta_accounts where tenant_id = ${tenantId} limit 1`))[0];
    if (!acc) return refuse('not_connected');
    if (acc.token_status !== 'valid') return refuse('reconnect');
    if (acc.health_state !== 'ok') return refuse('account_restricted');
    if (acc.payment_method_status === 'failing') return refuse('payment_banner');
    const ph = rows(await tx.execute(sql`select phone_number_id from phone_numbers where tenant_id = ${tenantId} order by created_at limit 1`))[0];
    if (!ph) return refuse('not_connected');

    const buttons = (t.buttons ?? []) as { type: string; value?: string }[];
    if (buttons.some((b) => b.type === 'copy_code') && !c.offer_code) return refuse('offer_code_missing');
    const offer = t.offer as { hasExpiration?: boolean } | null;
    const offerEnds = c.offer_expires_at ? new Date(String(c.offer_expires_at)).getTime() : null;
    if (offer?.hasExpiration && (!offerEnds || offerEnds <= Date.now() + 60_000)) return refuse(offerEnds ? 'offer_ended' : 'offer_time_missing');
    const tracked = buttons.some((b) => b.type === 'url' && !!appUrl && isTrackedButtonValue(b.value, appUrl));
    if (tracked) {
      if (!c.link_url) return refuse('link_missing');
      if (!appUrl || (strictAppUrl && isTemporaryAppUrl(appUrl))) return refuse('app_url_temporary');
    }

    // Held people, with their CURRENT contact record (consent and reachability may have changed since launch).
    const held = rows(await tx.execute(sql`
      select r.id as rid, ct.id, ct.phone_e164, ct.name, ct.consent_status, ct.reachability, ct.freq_cap_hold_until
      from campaign_recipients r join contacts ct on ct.id = r.contact_id and ct.tenant_id = r.tenant_id
      where r.campaign_id = ${campaignId} and r.tenant_id = ${tenantId} and r.state = 'held' order by r.id for update of r`));
    const category = String(t.category);
    const sendable = held.filter((h) => !skipReason(h, category));
    // A held person whose contact was deleted since launch has no contact row at all; they cannot be messaged, so they are skipped too.
    const orphans = rows(await tx.execute(sql`select r.id as rid from campaign_recipients r where r.campaign_id = ${campaignId} and r.tenant_id = ${tenantId} and r.state = 'held' and not exists (select 1 from contacts ct where ct.id = r.contact_id and ct.tenant_id = r.tenant_id)`));

    // Spend cap against what was already sent in the test plus what is about to go out now.
    const already = Number(rows(await tx.execute(sql`select count(*)::int n from campaign_recipients where campaign_id = ${campaignId} and tenant_id = ${tenantId} and state not in ('held','skipped')`))[0]!.n);
    const est = estimateCost(already + sendable.length, category as 'marketing');
    const cap = c.spend_cap_paise as number | null;
    if (cap !== null && est.totalPaise > cap) return refuse('spend_cap');

    let skipped = 0;
    for (const h of held) {
      const why = skipReason(h, category);
      if (why) { skipped++; await tx.execute(sql`update campaign_recipients set state = 'skipped', reason = ${why} where id = ${h.rid} and tenant_id = ${tenantId}`); }
    }
    for (const o of orphans) { skipped++; await tx.execute(sql`update campaign_recipients set state = 'skipped', reason = 'Contact was deleted' where id = ${o.rid} and tenant_id = ${tenantId}`); }

    const releasedAt = new Date();
    let position = 0;
    for (const h of sendable) {
      const notBefore = startTimeFor(position++, c.send_per_minute as number | null, releasedAt);
      const params = varMap.map((v) => resolveVar(String(v), { name: h.name as string | null, phone: String(h.phone_e164) }));
      // The held row already exists; it becomes a queued recipient of the chosen version. The state guard makes a replay a no-op.
      const cr = rows(await tx.execute(sql`update campaign_recipients set state = 'queued', version = ${useB ? 'b' : 'a'} where id = ${h.rid} and tenant_id = ${tenantId} and state = 'held' returning id`))[0];
      if (!cr) continue;
      let linkCode: string | undefined;
      if (tracked) {
        linkCode = generateLinkCode();
        await tx.execute(sql`insert into tracked_links (code, tenant_id, campaign_id, campaign_recipient_id) values (${linkCode}, ${tenantId}, ${campaignId}, ${cr.id})`);
      }
      const conv = rows(await tx.execute(sql`insert into conversations (tenant_id, contact_id, phone_number_id, status, unread) values (${tenantId}, ${h.id}, ${ph.phone_number_id}, 'open', 0) on conflict (tenant_id, contact_id) do update set phone_number_id = coalesce(conversations.phone_number_id, excluded.phone_number_id) returning id`))[0]!;
      await tx.execute(sql`insert into messages (tenant_id, conversation_id, direction, kind, body, status, template_name, template_language, template_category, payload, phone_number_id, campaign_recipient_id, not_before)
        values (${tenantId}, ${conv.id}, 'out', 'template', ${t.name}, 'queued', ${t.name}, ${t.language}, ${category}, ${JSON.stringify({ params, ...(linkCode ? { linkCode } : {}), ...(c.offer_code ? { code: c.offer_code } : {}), ...(offer?.hasExpiration && offerEnds ? { offerExpiresMs: offerEnds } : {}) })}::jsonb, ${ph.phone_number_id}, ${cr.id}, ${notBefore.getTime() > releasedAt.getTime() ? notBefore.toISOString() : null}::timestamptz)`);
    }
    // Reopen the campaign so the normal roll-up closes it again once these messages are done, and record what happened.
    await tx.execute(sql`update campaigns set status = 'running', completed_at = null, est_cost_paise = ${est.totalPaise} where id = ${campaignId} and tenant_id = ${tenantId}`);
    await tx.execute(sql`insert into audit_log (tenant_id, actor_type, action, entity, entity_id, after) values (${tenantId}, 'system', 'campaign.ab_released', 'campaign', ${campaignId}, ${JSON.stringify({ version: c.ab_release_version, queued: sendable.length, skipped })}::jsonb)`);
    return { campaignId, status: 'released' as const, queued: sendable.length, skipped };
  });
}

/** Campaigns where the owner has chosen a version and the release has not run yet. */
export async function dueReleases(db: Db, limit = 20) {
  return rows(await db.execute(sql`select id, tenant_id from campaigns where ab_release_version is not null and ab_released_at is null order by ab_release_requested_at limit ${limit}`)) as { id: string; tenant_id: string }[];
}
