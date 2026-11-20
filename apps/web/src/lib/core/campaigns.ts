/**
 * Campaign rules shared by the panel and the API for AI agents.
 * Everything takes an explicit actor, never a cookie, so there is exactly one place where "may this be sent" is decided.
 */
import { checkLinkDestination, isTrackedButtonValue } from '@lbc/shared/tracked-links';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audienceWhere, campaigns, loadGroups, templates, type Tx } from '@lbc/db';
import { variablesIn } from '@lbc/shared';
import { estimateCost } from '@/lib/cost';
import { dailyLimitPaise } from '@lbc/shared/api-keys';
import { audit, auditAs, db, type ActorCtx } from '@/lib/tenant-db';

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
export const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export interface AudiencePreview { total: number; sendable: number; optedOut: number; noRecord: number; cost: ReturnType<typeof estimateCost> }

/** Who would receive this campaign. Only people who agreed (consent = allowed) are sendable. Nobody is ever messaged without a record. */
export async function previewAudienceFor(ctx: ActorCtx, groupIds: string[], category: string): Promise<AudiencePreview> {
  return db(ctx, async (tx) => {
    const ids = z.array(z.string().uuid()).parse(groupIds);
    if (!ids.length) return { total: 0, sendable: 0, optedOut: 0, noRecord: 0, cost: estimateCost(0, category) };
    const groups = await loadGroups(tx, ctx.tenantId, ids);
    const r = await tx.execute(sql`
      select count(*)::int as total,
             count(*) filter (where c.consent_status = 'allowed')::int as sendable,
             count(*) filter (where c.consent_status = 'stopped')::int as opted_out,
             count(*) filter (where c.consent_status = 'unknown')::int as no_record
      from contacts c where c.tenant_id = ${ctx.tenantId}::uuid and ${audienceWhere(ctx.tenantId, groups)}`);
    const x = (r as unknown as { total: number; sendable: number; opted_out: number; no_record: number }[])[0]!;
    return { total: x.total, sendable: x.sendable, optedOut: x.opted_out, noRecord: x.no_record, cost: estimateCost(x.sendable, category) };
  });
}

export const campaignInput = z.object({
  name: z.string().trim().min(2, 'Give the campaign a name.').max(120),
  templateId: z.string().uuid('Choose an approved template.'),
  groupIds: z.array(z.string().uuid()).min(1, 'Choose at least one group.').max(50),
  when: z.enum(['now', 'later']),
  scheduledAt: z.string().optional(),
  repeat: z.enum(['none', 'daily', 'weekly', 'monthly']).default('none'),
  spendCapRupees: z.number().min(0).max(10_000_000).optional(),
  /** One entry per {{n}} in the body: '@name', '@fullname', '@phone' or fixed text. */
  varMap: z.array(z.string().trim().min(1, 'Fill in every variable.').max(200)).max(20).default([]),
  /** For a template with a Copy code button: the code every recipient gets (1 to 15 letters, numbers, - or _). */
  offerCode: z.string().trim().regex(/^[A-Za-z0-9_-]{1,15}$/, 'The offer code can be 1 to 15 letters or numbers.').optional(),
  /** For a template with a countdown: when the offer ends (ISO time). */
  offerEndsAt: z.string().optional(),
  /** For a template with a tracked website button: the page the button opens. https only. */
  linkUrl: z.string().trim().max(2000).optional(),
  /** Messages per minute; leave out (or 0) for as fast as possible. */
  sendPerMinute: z.number().int().min(0).max(6000).optional(),
  /** A/B test: a second template sent to a share of the people, so the report can compare the two. */
  abTemplateId: z.string().uuid('Choose the second template.').optional(),
  /** The blanks for the second template, same rules as varMap. */
  abVarMap: z.array(z.string().trim().min(1, 'Fill in every variable.').max(200)).max(20).optional(),
  /** Share of people who get the second template, 10 to 90. */
  abPercentB: z.number().int().min(10, 'Give the second template at least 10% of people.').max(90, 'Give the second template at most 90% of people.').optional(),
  /** Test on a small group first, keep everyone else back, and send them the winner when you choose. Needs an A/B test. */
  abHoldRest: z.boolean().optional(),
  /** With abHoldRest: the share of the audience that takes part in the test (split half and half), 10 to 50. */
  abTestPct: z.number().int().min(10, 'Test on at least 10% of people.').max(50, 'Test on at most half of your people, so the rest can get the winner.').optional(),
});
export type CampaignInput = z.input<typeof campaignInput>;

/** Creates a campaign as a draft or schedule. Never sends anything by itself. */
export async function createCampaignFor(ctx: ActorCtx, raw: CampaignInput): Promise<Result<{ id: string; status: string; estCostPaise: number; audience: number }>> {
  const p = campaignInput.safeParse(raw);
  if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the details.');
  const d = p.data;
  // The speed (a whole number, 0 to 6000) is already checked by the schema above.
  let when: Date | null = null;
  if (d.when === 'later') {
    when = d.scheduledAt ? new Date(d.scheduledAt) : null;
    if (!when || Number.isNaN(when.getTime())) return fail('Choose a date and time.');
    if (when.getTime() < Date.now() + 5 * 60_000) return fail('Pick a time at least 5 minutes from now.');
    if (when.getTime() > Date.now() + 90 * 86_400_000) return fail('You can schedule up to 90 days ahead.');
  }
  return db(ctx, async (tx) => {
    const [t] = await tx.select().from(templates).where(eq(templates.id, d.templateId));
    if (!t) return fail('That template was not found.');
    if (t.status !== 'approved') return fail('Only approved templates can be sent. Get this one approved first.');
    const groups = await tx.execute(sql`select id from contact_groups where id = any(${'{' + d.groupIds.join(',') + '}'}::uuid[])`);
    if ((groups as unknown as unknown[]).length !== d.groupIds.length) return fail('One of the groups no longer exists.');
    const hasCopy = ((t.buttons ?? []) as { type: string }[]).some((b) => b.type === 'copy_code');
    const appUrl = (process.env.APP_URL ?? '').replace(/\/+$/, '');
    const hasTracked = ((t.buttons ?? []) as { type: string; value?: string }[]).some((b) => b.type === 'url' && !!appUrl && isTrackedButtonValue(b.value, appUrl));
    let linkUrl: string | null = null;
    if (hasTracked) {
      if (!d.linkUrl) return fail('This template has a tracked website button. Enter the page it should open.');
      const chk = checkLinkDestination(d.linkUrl, appUrl);
      if (!chk.ok) return fail(chk.error);
      linkUrl = chk.url;
    } else if (d.linkUrl) return fail('This template has no tracked website button, so there is no link to set.');
    const offerCfg = t.offer as { hasExpiration?: boolean } | null;
    if (hasCopy && !d.offerCode) return fail('This template has a Copy code button. Enter the offer code.');
    let offerEnds: Date | null = null;
    if (offerCfg?.hasExpiration) {
      offerEnds = d.offerEndsAt ? new Date(d.offerEndsAt) : null;
      if (!offerEnds || Number.isNaN(offerEnds.getTime())) return fail('This offer has a countdown. Choose when the offer ends.');
      // The countdown must still be running when the LAST message goes out; a repeating send keeps the same end time, so it must outlive the first run.
      const firstRun = when ?? new Date();
      if (offerEnds.getTime() < firstRun.getTime() + 60 * 60_000) return fail('The offer must end at least an hour after the message is sent.');
      if (offerEnds.getTime() > firstRun.getTime() + 60 * 86_400_000) return fail('The offer can end at most 60 days after the message is sent.');
      if (d.repeat !== 'none') return fail('A countdown offer cannot repeat, because it would run out. Send it once.');
    }
    const needed = new Set(variablesIn(t.body)).size;
    if (d.varMap.length !== needed) return fail(needed ? `This template has ${needed} variable${needed > 1 ? 's' : ''}. Fill in each one.` : 'This template has no variables.');
    // A/B test: version B must be a different, approved template of the same kind, with nothing extra to fill in that A does not also need, so the two groups are comparable.
    let ab: { id: string; varMap: string[]; percent: number } | null = null;
    if ((d.abHoldRest || d.abTestPct) && !d.abTemplateId) return fail('Sending the winner later needs a second template to test.');
    if (d.abHoldRest && d.abTestPct === undefined) return fail('Choose how many people to test on first.');
    if (d.abTestPct !== undefined && !d.abHoldRest) return fail('The test share only applies when you keep the rest back for the winner.');
    if (d.abTemplateId || d.abVarMap || d.abPercentB || d.abHoldRest) {
      if (!d.abTemplateId) return fail('Choose the second template for the test.');
      if (d.abTemplateId === d.templateId) return fail('The two versions must be different templates.');
      if (d.repeat !== 'none') return fail('A test cannot repeat. Run it once, then repeat the winner.');
      const [tb] = await tx.select().from(templates).where(eq(templates.id, d.abTemplateId));
      if (!tb) return fail('The second template was not found.');
      if (tb.status !== 'approved') return fail('The second template is not approved yet.');
      if (tb.category !== t.category) return fail('Both versions must be the same kind of message (both promotional, or both updates). Different kinds are charged and limited differently, so the comparison would not be fair.');
      const copyB = ((tb.buttons ?? []) as { type: string }[]).some((b) => b.type === 'copy_code'), countB = !!(tb.offer as { hasExpiration?: boolean } | null)?.hasExpiration;
      if (copyB !== hasCopy || countB !== !!offerCfg?.hasExpiration) return fail('Both versions must be the same kind of offer: both with a Copy code button and a countdown, or neither.');
      const trackedB = ((tb.buttons ?? []) as { type: string; value?: string }[]).some((b) => b.type === 'url' && !!appUrl && isTrackedButtonValue(b.value, appUrl));
      if (trackedB !== hasTracked) return fail('Both versions need the same kind of website button: both tracked, or neither.');
      const neededB = new Set(variablesIn(tb.body)).size; const mapB = d.abVarMap ?? [];
      if (mapB.length !== neededB) return fail(neededB ? `The second template has ${neededB} variable${neededB > 1 ? 's' : ''}. Fill in each one.` : 'The second template has no variables.');
      if (d.abPercentB === undefined && !d.abHoldRest) return fail('Choose what share of people get the second template.');
      ab = { id: tb.id, varMap: mapB, percent: d.abHoldRest ? 50 : d.abPercentB! };
    }
    const aud = await previewAudienceFor(ctx, d.groupIds, t.category);
    if (aud.sendable === 0) return fail('No contact in these groups has agreed to messages, so there is nobody to send to.');
    if (ab && aud.sendable < 2) return fail('A test needs at least 2 people, one for each version.');
    // Holding the rest back only makes sense when there IS a rest: 2 people to test and at least 2 more to send the winner to.
    if (d.abHoldRest && aud.sendable < 4) return fail('To send the winner later you need at least 4 people: 2 for the test and 2 more to send the winner to. Test everyone now instead.');
    const capPaise = d.spendCapRupees ? Math.round(d.spendCapRupees * 100) : null;
    if (capPaise !== null && aud.cost.totalPaise > capPaise) return fail(`The estimated cost ${aud.cost.totalLabel} is above your spend cap. Raise the cap or choose fewer people.`);
    const [row] = await tx.insert(campaigns).values({
      tenantId: ctx.tenantId, name: d.name, templateId: t.id, groupIds: d.groupIds, status: d.when === 'now' ? 'draft' : 'scheduled', scheduledAt: when, repeat: d.repeat,
      estCostPaise: aud.cost.totalPaise, spendCapPaise: capPaise, counts: { audience: aud.sendable, optedOut: aud.optedOut, noRecord: aud.noRecord }, createdBy: ctx.user.id, varMap: d.varMap, offerCode: hasCopy ? d.offerCode! : null, linkUrl, sendPerMinute: d.sendPerMinute || null, abTemplateId: ab?.id ?? null, abVarMap: ab ? ab.varMap : null, abPercentB: ab?.percent ?? null, abHoldRest: !!d.abHoldRest, abTestPct: d.abHoldRest ? d.abTestPct! : null, offerExpiresAt: offerEnds, apiKeyId: ctx.via?.keyId ?? null,
    }).returning({ id: campaigns.id, status: campaigns.status });
    await auditAs(tx, ctx, 'campaign.created', 'campaign', row!.id, { audience: aud.sendable, ...(ab ? { abTest: { templateB: ab.id, percentB: ab.percent } } : {}) });
    return { ok: true as const, data: { id: row!.id, status: row!.status, estCostPaise: aud.cost.totalPaise, audience: aud.sendable } };
  });
}

/** True when this workspace has a valid WhatsApp connection with a number, so sends go to the real queue. */
export async function isLive(ctx: ActorCtx): Promise<boolean> {
  return db(ctx, async (tx) => {
    const r = await tx.execute(sql`select exists(select 1 from meta_accounts a join phone_numbers p on p.meta_account_id = a.id where a.token_status = 'valid' and a.health_state = 'ok') as live`);
    return !!(r as unknown as { live: boolean }[])[0]?.live;
  });
}

/**
 * Hands a campaign to the real pipeline. The worker's launcher (every 15 s) expands it, re-checks every rule per contact, and sends.
 * Nothing is sent from the web process.
 */
export async function queueCampaignFor(ctx: ActorCtx, id: string): Promise<Result<{ sent: number; testMode: false }>> {
  return db(ctx, (tx) => queueInTx(tx, ctx, id));
}

/** The queueing step itself, for callers that already hold a transaction (and locks) and must not open a second one. */
async function queueInTx(tx: Tx, ctx: ActorCtx, id: string): Promise<Result<{ sent: number; testMode: false }>> {
  // A suspended workspace cannot start sending. The sender would refuse every message anyway; this says so up front, once, in plain words.
  const ws = (await tx.execute(sql`select status from tenants where id = ${ctx.tenantId}::uuid`)) as unknown as { status: string }[];
  if (ws[0]?.status === 'suspended' || ws[0]?.status === 'offboarded') return fail('Sending is switched off for this workspace. Contact support.');
  const r = await tx.execute(sql`update campaigns set status = 'scheduled', scheduled_at = least(coalesce(scheduled_at, now()), now()) where id = ${id}::uuid and status in ('draft','scheduled','paused') returning (counts->>'audience')::int as n`);
  const row = (r as unknown as { n: number | null }[])[0];
  if (!row) return fail('This campaign has already been sent.');
  await auditAs(tx, ctx, 'campaign.queued', 'campaign', id, { audience: row.n });
  return { ok: true as const, data: { sent: row.n ?? 0, testMode: false as const } };
}

/** Only drafts, scheduled and paused campaigns can be cancelled. */
export async function cancelCampaignFor(ctx: ActorCtx, id: string): Promise<Result> {
  return db(ctx, async (tx) => {
    const r = await tx.update(campaigns).set({ status: 'cancelled' }).where(and(eq(campaigns.id, id), sql`${campaigns.status} in ('draft','scheduled','paused')`)).returning({ id: campaigns.id });
    if (!r.length) return fail('Only a campaign that has not started can be cancelled.');
    await auditAs(tx, ctx, 'campaign.cancelled', 'campaign', id);
    return { ok: true as const, data: null };
  });
}
void audit;

/**
 * Starts a campaign on behalf of an API key. Same pipeline as the panel (the worker re-checks every rule per contact), plus the key's own money limits:
 *  - one send may not cost more than the key's per-send cap;
 *  - everything the key started in the last 24 hours may not cost more than three times that cap.
 * The checks and the status change happen under one lock per key, so two sends fired at the same moment cannot both pass.
 * Only campaigns this same key created can be started by it.
 */
export async function sendCampaignViaKey(ctx: ActorCtx, id: string): Promise<Result<{ queued: number; costPaise: number; dailyUsedPaise: number; dailyLimitPaise: number }>> {
  const via = ctx.via;
  if (!via) return fail('This is only for API keys.');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail('That campaign id is not valid.');
  return db(ctx, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${via.keyId}))`);
    const [c] = (await tx.execute(sql`select id, status, est_cost_paise, api_key_id, api_sent_at, (counts->>'audience')::int as audience from campaigns where id = ${id}::uuid for update`)) as unknown as { id: string; status: string; est_cost_paise: number; api_key_id: string | null; api_sent_at: Date | null; audience: number | null }[];
    if (!c) return fail('That campaign was not found.');
    if (c.api_key_id !== via.keyId) return fail('This key can only start campaigns it created itself. Create the campaign with this key, or start it from the panel.');
    // A start is a one-time act: once this key has started it, asking again must not queue it or count its cost twice, even while the worker has not picked it up yet.
    if (c.api_sent_at) return fail('This campaign was already started. It cannot be started twice.');
    if (!['draft', 'scheduled', 'paused'].includes(c.status)) return fail('This campaign has already been sent.');
    if (c.est_cost_paise > via.sendCapPaise) return fail(`This send is estimated at ₹${(c.est_cost_paise / 100).toFixed(2)}, above this key’s limit of ₹${(via.sendCapPaise / 100).toFixed(2)} per send. Nothing was sent. Ask the workspace owner to raise the limit or send it from the panel.`);
    const [u] = (await tx.execute(sql`select coalesce(sum(est_cost_paise), 0)::bigint as used from campaigns where api_key_id = ${via.keyId}::uuid and api_sent_at > now() - interval '24 hours'`)) as unknown as { used: string }[];
    const used = Number(u!.used), dayLimit = dailyLimitPaise(via.sendCapPaise);
    if (used + c.est_cost_paise > dayLimit) return fail(`This key has already started ₹${(used / 100).toFixed(2)} of sends in the last 24 hours and its daily limit is ₹${(dayLimit / 100).toFixed(2)}. Nothing was sent.`);
    const r = await queueInTx(tx, ctx, id);
    if (!r.ok) return r;
    await tx.execute(sql`update campaigns set api_sent_at = now() where id = ${id}::uuid`);
    return { ok: true as const, data: { queued: r.data.sent, costPaise: c.est_cost_paise, dailyUsedPaise: used + c.est_cost_paise, dailyLimitPaise: dayLimit } };
  });
}


/**
 * The owner chooses which version goes to everyone who was kept back. This only records the choice and asks the worker to act; the worker checks every safety rule
 * again at the moment of sending. Allowed once, and only after the test group has been sent to, so a winner cannot be picked on no evidence at all.
 */
export async function releaseWinnerFor(ctx: ActorCtx, id: string, version: 'a' | 'b'): Promise<Result<{ held: number }>> {
  if (version !== 'a' && version !== 'b') return fail('Choose version A or version B.');
  if (!z.string().uuid().safeParse(id).success) return fail('That campaign id is not valid.');
  return db(ctx, async (tx) => {
    const [c] = (await tx.execute(sql`select status, ab_hold_rest, ab_release_version, ab_released_at from campaigns where id = ${id}::uuid for update`)) as unknown as { status: string; ab_hold_rest: boolean; ab_release_version: string | null; ab_released_at: Date | null }[];
    if (!c) return fail('That campaign was not found.');
    if (!c.ab_hold_rest) return fail('This campaign was not set up to keep people back for a winner.');
    if (c.ab_released_at) return fail('The winner has already been sent to everyone else.');
    if (c.ab_release_version) return fail('The winner is already on its way to everyone else.');
    if (!['running', 'completed'].includes(c.status)) return fail('The test has not been sent yet.');
    const [n] = (await tx.execute(sql`select count(*) filter (where state = 'held')::int as held, count(*) filter (where phase = 'test' and state in ('queued','retry_wait'))::int as test_waiting, count(*) filter (where phase = 'test' and state not in ('skipped','queued','retry_wait'))::int as test_sent from campaign_recipients where campaign_id = ${id}::uuid`)) as unknown as { held: number; test_waiting: number; test_sent: number }[];
    if (!n || n.held === 0) return fail('Nobody is being kept back, so there is nobody to send the winner to.');
    if (n.test_waiting > 0) return fail('The test messages are still being sent. Wait until they have all gone out, then choose.');
    if (n.test_sent === 0) return fail('No test message went out, so there is nothing to compare.');
    await tx.execute(sql`update campaigns set ab_release_version = ${version}, ab_release_requested_at = now(), ab_release_requested_by = ${ctx.user.id}, ab_release_error = null where id = ${id}::uuid`);
    await auditAs(tx, ctx, 'campaign.ab_release_requested', 'campaign', id, { version, held: n.held });
    return { ok: true as const, data: { held: n.held } };
  });
}
