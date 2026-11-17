import { sql } from 'drizzle-orm';
import { variablesIn } from '@lbc/shared';
import { journeyTemplateProblem, parseSteps, type JourneyStep } from '@lbc/shared/journeys';
import type { Db } from '@lbc/db';
import { resolveVar } from './campaigns';

/**
 * Journey engine. Every few seconds it looks for runs that are due and moves each one forward as far as it can go:
 * a wait ends the pass (the run comes back later), a message is queued like any other message (the send queue then applies
 * the usual checks, quiet hours and speed), a tag is added. One run is one transaction, so a crash can never half-do a step,
 * and the unique (run, step) index on messages means a step can never send twice.
 */
type Row = Record<string, unknown>;
const rows = (r: unknown) => r as Row[];

export interface JourneyDeps { db: Db; appUrl?: string; now?: () => Date }
export interface TickResult { due: number; advanced: number; sent: number; stopped: number; failed: number }

const BATCH = 100;
/** A template that is not approved yet (paused, in review) is waited for, up to two days, then the person leaves the journey. */
const TEMPLATE_WAIT_MS = 30 * 60_000, TEMPLATE_WAIT_TRIES = 96;
const RETRY_MS = 5 * 60_000, MAX_ERRORS = 5;

export async function tickJourneys(d: JourneyDeps): Promise<TickResult> {
  const out: TickResult = { due: 0, advanced: 0, sent: 0, stopped: 0, failed: 0 };
  const due = rows(await d.db.execute(sql`
    select r.id, r.tenant_id from journey_runs r join journeys j on j.id = r.journey_id and j.tenant_id = r.tenant_id
    where r.status = 'active' and r.next_run_at <= now() and j.status = 'active' order by r.next_run_at limit ${BATCH}`));
  out.due = due.length;
  for (const r of due) {
    try {
      const x = await advanceRun(d, String(r.tenant_id), String(r.id));
      out.advanced += x.moved ? 1 : 0; out.sent += x.sent; out.stopped += x.stopped ? 1 : 0;
    } catch (e) {
      out.failed++;
      const msg = (e as Error).message.slice(0, 300);
      await d.db.execute(sql`
        update journey_runs set attempts = attempts + 1, last_error = ${msg},
          next_run_at = now() + (${RETRY_MS} || ' milliseconds')::interval,
          status = case when attempts + 1 >= ${MAX_ERRORS} then 'failed' else status end,
          finished_at = case when attempts + 1 >= ${MAX_ERRORS} then now() else finished_at end
        where id = ${String(r.id)}::uuid and tenant_id = ${String(r.tenant_id)}::uuid and status = 'active'`);
    }
  }
  return out;
}

interface Advance { moved: boolean; sent: number; stopped: boolean }

export async function advanceRun(d: JourneyDeps, tenantId: string, runId: string): Promise<Advance> {
  const now = (d.now ?? (() => new Date()))();
  return d.db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    // Lock this run so two ticks can never work on it at once.
    const run = rows(await t.execute(sql`select * from journey_runs where id = ${runId}::uuid and tenant_id = ${tenantId}::uuid and status = 'active' for update skip locked`))[0];
    if (!run) return { moved: false, sent: 0, stopped: false };
    if (new Date(String(run.next_run_at)) > now) return { moved: false, sent: 0, stopped: false };
    const j = rows(await t.execute(sql`select status, steps, stop_on_reply from journeys where id = ${String(run.journey_id)}::uuid and tenant_id = ${tenantId}::uuid`))[0];
    if (!j || j.status !== 'active') return { moved: false, sent: 0, stopped: false };
    const steps = parseSteps(j.steps);

    const stop = async (reason: string) => {
      await t.execute(sql`update journey_runs set status = 'stopped', stop_reason = ${reason}, finished_at = now() where id = ${runId}::uuid and tenant_id = ${tenantId}::uuid`);
      return { moved: true, sent: 0, stopped: true } as Advance;
    };
    const c = rows(await t.execute(sql`select id, name, phone_e164, consent_status, reachability, last_inbound_at from contacts where id = ${String(run.contact_id)}::uuid and tenant_id = ${tenantId}::uuid`))[0];
    if (!c) return stop('contact_deleted');
    if (c.consent_status === 'stopped') return stop('opted_out');
    if (c.reachability === 'unreachable') return stop('unreachable');
    // A reply ends the journey: the customer is talking to a person now, and a scripted message on top of that is rude.
    if (j.stop_on_reply && c.last_inbound_at && new Date(String(c.last_inbound_at)) > new Date(String(run.started_at))) return stop('replied');

    let index = Number(run.step_index), sent = 0;
    for (let guard = 0; guard < 25; guard++) {
      if (index >= steps.length) {
        await t.execute(sql`update journey_runs set status = 'completed', step_index = ${index}, finished_at = now() where id = ${runId}::uuid and tenant_id = ${tenantId}::uuid`);
        return { moved: true, sent, stopped: false };
      }
      const step = steps[index] as JourneyStep;
      if (step.type === 'wait') {
        await t.execute(sql`update journey_runs set step_index = ${index + 1}, next_run_at = ${new Date(now.getTime() + step.minutes * 60_000).toISOString()}::timestamptz, attempts = 0, last_error = null where id = ${runId}::uuid and tenant_id = ${tenantId}::uuid`);
        return { moved: true, sent, stopped: false };
      }
      if (step.type === 'add_tag') {
        await t.execute(sql`update contacts set tags = (select coalesce(array_agg(distinct x), '{}'::text[]) from unnest(tags || ARRAY[${step.tag}]::text[]) x), updated_at = now() where id = ${String(c.id)}::uuid and tenant_id = ${tenantId}::uuid`);
        index++; continue;
      }
      // send_template
      const tpl = rows(await t.execute(sql`select id, name, language, category, category_current, status, body, buttons, offer from templates where id = ${step.templateId}::uuid and tenant_id = ${tenantId}::uuid`))[0];
      if (!tpl) return stop('template_missing');
      const blanks = new Set(variablesIn(String(tpl.body))).size;
      const problem = journeyTemplateProblem({ status: 'approved', category: String(tpl.category), body: String(tpl.body), buttons: (tpl.buttons ?? []) as { type: string; value?: string }[], offer: tpl.offer }, blanks, d.appUrl ?? '', step.varMap.length);
      if (problem) return stop('template_changed');
      if (tpl.status !== 'approved') {
        const tries = Number(run.attempts) + 1;
        if (tries >= TEMPLATE_WAIT_TRIES) return stop('template_not_approved');
        await t.execute(sql`update journey_runs set attempts = ${tries}, next_run_at = ${new Date(now.getTime() + TEMPLATE_WAIT_MS).toISOString()}::timestamptz where id = ${runId}::uuid and tenant_id = ${tenantId}::uuid`);
        return { moved: true, sent, stopped: false };
      }
      const category = String(tpl.category_current ?? tpl.category);
      if (category === 'marketing' && c.consent_status !== 'allowed') return stop('no_permission');
      const ph = rows(await t.execute(sql`select phone_number_id from phone_numbers where tenant_id = ${tenantId}::uuid order by created_at limit 1`))[0];
      if (!ph) throw new Error('No WhatsApp number is connected');
      const conv = rows(await t.execute(sql`
        insert into conversations (tenant_id, contact_id, phone_number_id, status, unread) values (${tenantId}::uuid, ${String(c.id)}::uuid, ${String(ph.phone_number_id)}, 'open', 0)
        on conflict (tenant_id, contact_id) do update set phone_number_id = coalesce(conversations.phone_number_id, excluded.phone_number_id) returning id`))[0]!;
      const params = step.varMap.map((v) => resolveVar(v, { name: c.name as string | null, phone: String(c.phone_e164) }));
      // One message per (run, step), enforced by a unique index: if this step was ever sent, the insert does nothing.
      const ins = rows(await t.execute(sql`
        insert into messages (tenant_id, conversation_id, direction, kind, body, status, template_name, template_language, template_category, payload, phone_number_id, journey_run_id, journey_step)
        values (${tenantId}::uuid, ${String(conv.id)}::uuid, 'out', 'template', ${String(tpl.name)}, 'queued', ${String(tpl.name)}, ${String(tpl.language)}, ${category}, ${JSON.stringify({ params })}::jsonb, ${String(ph.phone_number_id)}, ${runId}::uuid, ${index})
        on conflict (journey_run_id, journey_step) do nothing returning id`));
      if (ins[0]) sent++;
      index++;
    }
    throw new Error('Journey has too many steps in a row without a wait');
  });
}
