'use server';

import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { variablesIn } from '@lbc/shared';
import { STOP_REASONS, journeyInput, journeyProblem, journeyTemplateProblem, parseSteps, parseTrigger, type JourneyInput, type JourneyStep, type JourneyTrigger } from '@lbc/shared/journeys';
import { audienceWhere, enrollContacts, journeys, loadGroups } from '@lbc/db';
import { Forbidden, assertRole, audit, db, requireCtx, type Ctx } from '@/lib/session';

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const UUID = /^[0-9a-f-]{36}$/i;

async function admin(): Promise<{ ctx: Ctx } | { error: string }> {
  const ctx = await requireCtx();
  try { assertRole(ctx, 'admin'); } catch (e) { if (e instanceof Forbidden) return { error: 'Only the workspace owner or an admin can change journeys.' }; throw e; }
  return { ctx };
}
const appUrl = () => (process.env.APP_URL ?? '').replace(/\/+$/, '');

export interface JourneyRow {
  id: string; name: string; status: 'draft' | 'active' | 'paused'; trigger: JourneyTrigger; steps: JourneyStep[]; stopOnReply: boolean; updatedAt: string;
  counts: { active: number; completed: number; stopped: number; failed: number };
}

export async function listJourneys(): Promise<JourneyRow[]> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => {
    const js = await tx.select().from(journeys).orderBy(sql`${journeys.updatedAt} desc`);
    const cs = (await tx.execute(sql`select journey_id, status, count(*)::int n from journey_runs group by 1, 2`)) as unknown as { journey_id: string; status: string; n: number }[];
    return js.map((j) => {
      const c = { active: 0, completed: 0, stopped: 0, failed: 0 };
      for (const x of cs) if (x.journey_id === j.id && x.status in c) c[x.status as keyof typeof c] = x.n;
      return { id: j.id, name: j.name, status: j.status as JourneyRow['status'], trigger: parseTrigger(j.trigger), steps: parseSteps(j.steps), stopOnReply: j.stopOnReply, updatedAt: j.updatedAt.toISOString(), counts: c };
    });
  });
}

export interface TemplateChoice { id: string; name: string; category: string; body: string; blanks: number; usable: boolean; why: string | null }
/** Every template, marked with whether a journey can use it and why not, so the picker can explain instead of hiding. */
export async function listTemplateChoices(): Promise<TemplateChoice[]> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => {
    const rows = (await tx.execute(sql`select id, name, category, status, body, buttons, offer from templates where status <> 'deleting' order by name`)) as unknown as { id: string; name: string; category: string; status: string; body: string; buttons: { type: string; value?: string }[]; offer: unknown }[];
    return rows.map((t) => {
      const blanks = new Set(variablesIn(t.body)).size;
      const why = journeyTemplateProblem({ status: t.status, category: t.category, body: t.body, buttons: t.buttons ?? [], offer: t.offer }, blanks, appUrl(), blanks);
      return { id: t.id, name: t.name, category: t.category, body: t.body, blanks, usable: !why, why };
    });
  });
}

export interface Teammate { userId: string; name: string; role: string }
/** People who can be given a chat. Viewers cannot work chats, so they are not offered. */
export async function listAssignees(): Promise<Teammate[]> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => (await tx.execute(sql`select m.user_id as "userId", u.name, m.role from tenant_members m join "user" u on u.id = m.user_id where m.tenant_id = ${ctx.tenantId}::uuid and m.role <> 'viewer' order by u.name`)) as unknown as Teammate[]);
}

export async function listLeadSources(): Promise<{ id: string; name: string }[]> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => (await tx.execute(sql`select id, name from lead_sources order by name`)) as unknown as { id: string; name: string }[]);
}

/** Checks the whole journey against the workspace's own templates. Returns the first plain-words problem, or null. */
async function checkAgainstTemplates(tx: Parameters<Parameters<typeof db>[1]>[0], steps: JourneyStep[], trigger: JourneyTrigger): Promise<string | null> {
  const whole = journeyProblem(steps); if (whole) return whole;
  let n = 0;
  for (const s of steps) {
    n++;
    if (s.type !== 'send_template') continue;
    const [t] = (await tx.execute(sql`select status, category, body, buttons, offer, name from templates where id = ${s.templateId}::uuid`)) as unknown as { status: string; category: string; body: string; buttons: { type: string; value?: string }[]; offer: unknown; name: string }[];
    if (!t) return `Step ${n}: that template was not found.`;
    const p = journeyTemplateProblem({ status: t.status, category: t.category, body: t.body, buttons: t.buttons ?? [], offer: t.offer }, new Set(variablesIn(t.body)).size, appUrl(), s.varMap.length);
    if (p) return `Step ${n} (“${t.name}”): ${p}`;
  }
  for (const [i, s] of steps.entries()) {
    if (s.type !== 'assign') continue;
    const [m] = (await tx.execute(sql`select role from tenant_members where user_id = ${s.userId}`)) as unknown as { role: string }[];
    if (!m) return `Step ${i + 1}: that teammate is not in this workspace.`;
    if (m.role === 'viewer') return `Step ${i + 1}: viewers cannot work chats, so they cannot be given one.`;
  }
  if (trigger.type === 'lead_created' && trigger.sourceId) {
    const [src] = (await tx.execute(sql`select id from lead_sources where id = ${trigger.sourceId}::uuid`)) as unknown as { id: string }[];
    if (!src) return 'That lead source was not found.';
  }
  return null;
}

export async function saveJourney(input: JourneyInput & { id?: string }): Promise<Result<{ id: string }>> {
  const g = await admin(); if ('error' in g) return fail(g.error);
  const p = journeyInput.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the journey.');
  const d = p.data;
  if (input.id && !UUID.test(input.id)) return fail('That journey id is not valid.');
  return db(g.ctx, async (tx) => {
    const problem = await checkAgainstTemplates(tx, d.steps, d.trigger); if (problem) return fail(problem);
    const dup = (await tx.execute(sql`select id from journeys where lower(name) = lower(${d.name}) ${input.id ? sql`and id <> ${input.id}::uuid` : sql``}`)) as unknown as unknown[];
    if (dup.length) return fail('You already have a journey with this name.');
    if (input.id) {
      const [cur] = await tx.select({ status: journeys.status }).from(journeys).where(eq(journeys.id, input.id));
      if (!cur) return fail('That journey was not found.');
      // Editing steps under people who are mid-way would move them to the wrong step. Pause first, then edit.
      if (cur.status === 'active') return fail('Pause the journey before changing it, so nobody is moved to the wrong step.');
      await tx.update(journeys).set({ name: d.name, trigger: d.trigger, steps: d.steps, stopOnReply: d.stopOnReply, updatedAt: new Date() }).where(eq(journeys.id, input.id));
      await audit(tx, 'journey.updated', 'journey', input.id);
      revalidatePath('/journeys');
      return { ok: true as const, data: { id: input.id } };
    }
    const [row] = await tx.insert(journeys).values({ tenantId: g.ctx.tenantId, name: d.name, trigger: d.trigger, steps: d.steps, stopOnReply: d.stopOnReply, createdBy: g.ctx.user.id }).returning({ id: journeys.id });
    await audit(tx, 'journey.created', 'journey', row!.id);
    revalidatePath('/journeys');
    return { ok: true as const, data: { id: row!.id } };
  });
}

/** draft or paused -> active (re-checks everything, so a journey whose template changed cannot start), active -> paused. */
export async function setJourneyStatus(id: string, to: 'active' | 'paused'): Promise<Result> {
  const g = await admin(); if ('error' in g) return fail(g.error);
  if (!UUID.test(id)) return fail('That journey id is not valid.');
  if (to !== 'active' && to !== 'paused') return fail('Choose start or pause.');
  return db(g.ctx, async (tx) => {
    const [j] = await tx.select().from(journeys).where(eq(journeys.id, id));
    if (!j) return fail('That journey was not found.');
    if (to === 'active') {
      const problem = await checkAgainstTemplates(tx, parseSteps(j.steps), parseTrigger(j.trigger));
      if (problem) return fail(problem);
      const live = ((await tx.execute(sql`select exists(select 1 from meta_accounts a join phone_numbers p on p.meta_account_id = a.id where a.token_status = 'valid' and a.health_state = 'ok') as live`)) as unknown as { live: boolean }[])[0]?.live === true;
      if (!live) return fail('Connect your WhatsApp number first. A journey has nothing to send with until then.');
      const steps = parseSteps(j.steps);
      if (steps.some((s) => s.type === 'send_template')) {
        const t = appUrl();
        if (!t) return fail('The app address is not set, so journeys cannot start yet.');
      }
    }
    await tx.update(journeys).set({ status: to, updatedAt: new Date() }).where(eq(journeys.id, id));
    await audit(tx, to === 'active' ? 'journey.started' : 'journey.paused', 'journey', id);
    revalidatePath('/journeys');
    return { ok: true as const, data: null };
  });
}

export async function deleteJourney(id: string): Promise<Result> {
  const g = await admin(); if ('error' in g) return fail(g.error);
  if (!UUID.test(id)) return fail('That journey id is not valid.');
  return db(g.ctx, async (tx) => {
    const [j] = await tx.select({ status: journeys.status, name: journeys.name }).from(journeys).where(eq(journeys.id, id));
    if (!j) return fail('That journey was not found.');
    if (j.status === 'active') return fail('Pause the journey before deleting it.');
    await tx.delete(journeys).where(eq(journeys.id, id));
    await audit(tx, 'journey.deleted', 'journey', id, { name: j.name });
    revalidatePath('/journeys');
    return { ok: true as const, data: null };
  });
}

/** Puts every person in a group into a running journey. People who opted out are skipped and counted. */
export async function enrollGroup(journeyId: string, groupId: string): Promise<Result<{ enrolled: number; alreadyIn: number; optedOut: number; limited: boolean }>> {
  const g = await admin(); if ('error' in g) return fail(g.error);
  if (!UUID.test(journeyId) || !UUID.test(groupId)) return fail('Choose a journey and a group.');
  return db(g.ctx, async (tx) => {
    const [grp] = (await tx.execute(sql`select id, kind, filter from contact_groups where id = ${groupId}::uuid`)) as unknown as { id: string; kind: string; filter: unknown }[];
    if (!grp) return fail('That group was not found.');
    const groups = await loadGroups(tx, g.ctx.tenantId, [groupId]);
    const ids = ((await tx.execute(sql`select c.id from contacts c where c.tenant_id = ${g.ctx.tenantId}::uuid and ${audienceWhere(g.ctx.tenantId, groups)} limit 5000`)) as unknown as { id: string }[]).map((r) => r.id);
    if (!ids.length) return fail('Nobody is in that group yet.');
    const r = await enrollContacts(tx, g.ctx.tenantId, journeyId, ids);
    if (r.refused === 'not_active') return fail('Start the journey first. It only takes people while it is running.');
    if (r.refused === 'daily_limit' && r.enrolled === 0) return fail('This journey already took the most people it can in a day. Try again tomorrow.');
    await audit(tx, 'journey.enrolled', 'journey', journeyId, { group: groupId, enrolled: r.enrolled, alreadyIn: r.alreadyIn, optedOut: r.optedOut });
    revalidatePath('/journeys');
    return { ok: true as const, data: { enrolled: r.enrolled, alreadyIn: r.alreadyIn, optedOut: r.optedOut, limited: r.refused === 'daily_limit' } };
  });
}

/** Stops everyone currently in a journey (a safety button). */
export async function stopAllRuns(journeyId: string): Promise<Result<{ stopped: number }>> {
  const g = await admin(); if ('error' in g) return fail(g.error);
  if (!UUID.test(journeyId)) return fail('That journey id is not valid.');
  return db(g.ctx, async (tx) => {
    const r = (await tx.execute(sql`update journey_runs set status = 'stopped', stop_reason = 'stopped_by_owner', finished_at = now() where journey_id = ${journeyId}::uuid and status = 'active' returning id`)) as unknown as unknown[];
    await audit(tx, 'journey.stopped_all', 'journey', journeyId, { stopped: r.length });
    revalidatePath('/journeys');
    return { ok: true as const, data: { stopped: r.length } };
  });
}

export interface RunRow { name: string | null; phone: string; status: string; step: number; nextAt: string | null; reason: string | null; error: string | null }
export async function listRuns(journeyId: string): Promise<RunRow[]> {
  const ctx = await requireCtx();
  if (!UUID.test(journeyId)) return [];
  return db(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      select c.name, c.phone_e164, r.status, r.step_index, r.next_run_at, r.stop_reason, r.last_error
      from journey_runs r join contacts c on c.id = r.contact_id where r.journey_id = ${journeyId}::uuid order by r.started_at desc limit 100`)) as unknown as { name: string | null; phone_e164: string; status: string; step_index: number; next_run_at: Date | null; stop_reason: string | null; last_error: string | null }[];
    return rows.map((r) => ({ name: r.name, phone: r.phone_e164, status: r.status, step: r.step_index, nextAt: r.status === 'active' && r.next_run_at ? new Date(r.next_run_at).toISOString() : null, reason: r.stop_reason ? (STOP_REASONS[r.stop_reason] ?? r.stop_reason) : null, error: r.last_error ? 'Something went wrong; it will try again.' : null }));
  });
}
