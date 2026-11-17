/**
 * Journeys: the rules that need no database. Used by the builder screen, the save action, the agent API and the worker.
 * A journey is a short list of steps a person walks through one at a time.
 */
import { z } from 'zod';

export const MAX_STEPS = 20;
export const MAX_WAIT_MINUTES = 60 * 24 * 60;   // 60 days

export const journeyStep = z.discriminatedUnion('type', [
  z.object({ type: z.literal('wait'), minutes: z.number().int().min(1, 'A wait must be at least 1 minute.').max(MAX_WAIT_MINUTES, 'A wait can be 60 days at most.') }),
  z.object({
    type: z.literal('send_template'),
    templateId: z.string().uuid('Choose an approved template.'),
    /** One entry per {{n}} in the template body: '@name', '@fullname', '@phone' or fixed text. */
    varMap: z.array(z.string().trim().min(1, 'Fill in every blank.').max(200)).max(20).default([]),
  }),
  z.object({ type: z.literal('add_tag'), tag: z.string().trim().min(1, 'Enter a tag.').max(40, 'Tags can be 40 characters at most.').regex(/^[^,;\n]+$/, 'A tag cannot contain commas or new lines.') }),
]);
export type JourneyStep = z.infer<typeof journeyStep>;

export const journeyTrigger = z.discriminatedUnion('type', [
  z.object({ type: z.literal('manual') }),
  z.object({ type: z.literal('lead_created'), sourceId: z.string().uuid().optional() }),
]);
export type JourneyTrigger = z.infer<typeof journeyTrigger>;

export const journeyInput = z.object({
  name: z.string().trim().min(2, 'Give the journey a name.').max(80),
  trigger: journeyTrigger,
  steps: z.array(journeyStep).min(1, 'Add at least one step.').max(MAX_STEPS, `A journey can have ${MAX_STEPS} steps at most.`),
  stopOnReply: z.boolean().default(true),
});
export type JourneyInput = z.input<typeof journeyInput>;

/** Reads steps stored in the database. Anything unreadable becomes an empty list, so a damaged journey does nothing instead of misfiring. */
export function parseSteps(raw: unknown): JourneyStep[] {
  const p = z.array(journeyStep).max(MAX_STEPS).safeParse(raw);
  return p.success ? p.data : [];
}

export function parseTrigger(raw: unknown): JourneyTrigger {
  const p = journeyTrigger.safeParse(raw);
  return p.success ? p.data : { type: 'manual' };
}

/** Problems that would make a journey misbehave, in plain words. Null when fine. Whole-journey rules the schema cannot express. */
export function journeyProblem(steps: JourneyStep[]): string | null {
  if (!steps.some((s) => s.type === 'send_template')) return 'A journey needs at least one message to send.';
  if (steps[steps.length - 1]?.type === 'wait') return 'A journey cannot end with a wait. Remove it, or add a message after it.';
  // Several messages back to back would arrive together, which feels like spam. Make people wait between them.
  for (let i = 1; i < steps.length; i++) if (steps[i]!.type === 'send_template' && steps[i - 1]!.type === 'send_template') return 'Put a wait between two messages so they do not arrive together.';
  return null;
}

export interface TemplateFacts { status: string; category: string; body: string; buttons: { type: string; value?: string }[]; offer: unknown }

/**
 * Can this template be used inside a journey? Templates that need a per-campaign value (an offer code, an offer end time, or a
 * tracked link) cannot, because a journey has no place to give those. Returns a plain-words problem, or null.
 */
export function journeyTemplateProblem(t: TemplateFacts, blankCount: number, appUrl: string, filledBlanks: number): string | null {
  if (t.status !== 'approved') return 'Only approved templates can be used. Get this one approved first.';
  if (t.buttons.some((b) => b.type === 'copy_code')) return 'This template has a Copy code button, which needs a code for each campaign. Use it in a campaign instead.';
  if (t.offer && (t.offer as { hasExpiration?: boolean }).hasExpiration) return 'This template has an offer countdown, which needs an end time for each campaign. Use it in a campaign instead.';
  const base = appUrl.replace(/\/+$/, '');
  if (base && t.buttons.some((b) => b.type === 'url' && (b.value ?? '').trim() === `${base}/r/{{1}}`)) return 'This template has a tracked link, which needs a page chosen for each campaign. Use it in a campaign instead.';
  if (filledBlanks !== blankCount) return blankCount ? `This template has ${blankCount} blank${blankCount > 1 ? 's' : ''}. Fill in each one.` : 'This template has no blanks to fill.';
  return null;
}

export function describeStep(s: JourneyStep, names: { templates?: Record<string, string> } = {}): string {
  if (s.type === 'wait') return `Wait ${describeMinutes(s.minutes)}`;
  if (s.type === 'add_tag') return `Add the tag “${s.tag}”`;
  return `Send “${names.templates?.[s.templateId] ?? 'a template'}”`;
}

export function describeMinutes(m: number): string {
  if (m % 1440 === 0) { const d = m / 1440; return `${d} day${d === 1 ? '' : 's'}`; }
  if (m % 60 === 0) { const h = m / 60; return `${h} hour${h === 1 ? '' : 's'}`; }
  return `${m} minute${m === 1 ? '' : 's'}`;
}

/** How long the whole journey takes from the first message to the last, in minutes (waits only; sending itself is instant). */
export function totalWaitMinutes(steps: JourneyStep[]): number {
  return steps.reduce((n, s) => n + (s.type === 'wait' ? s.minutes : 0), 0);
}

export const STOP_REASONS: Record<string, string> = {
  replied: 'Replied, so the journey stopped.',
  opted_out: 'Opted out of messages.',
  no_permission: 'No permission on record for promotions.',
  unreachable: 'Cannot receive WhatsApp messages.',
  contact_deleted: 'Contact was deleted.',
  stopped_by_owner: 'Stopped by you.',
  template_missing: 'The template was deleted.',
  template_changed: 'The template changed after this journey was built.',
  template_not_approved: 'The template stayed unapproved for too long.',
};
