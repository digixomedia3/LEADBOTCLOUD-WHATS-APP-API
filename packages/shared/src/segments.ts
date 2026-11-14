import { z } from 'zod';
import { LEAD_STATUSES } from './leads';

/**
 * Saved segments ("smart groups"): a list of rules that is re-read every time it is used, so a segment is never out of date.
 * A segment only chooses WHO is considered. It never grants permission: consent is checked again at send time, whatever the rules say.
 */
export const CAMPAIGN_OUTCOMES = ['received', 'read', 'replied', 'not_read', 'not_replied', 'failed'] as const;

const uuid = z.string().uuid();
const days = z.number().int().min(1).max(3650);

export const segmentRule = z.union([
  z.object({ type: z.literal('tag'), op: z.enum(['has', 'not_has']), value: z.string().trim().min(1).max(60) }),
  z.object({ type: z.literal('lead_status'), op: z.enum(['is', 'is_not']), values: z.array(z.enum(LEAD_STATUSES)).min(1).max(6) }),
  z.object({ type: z.literal('lead_source'), op: z.enum(['is', 'is_not']), sourceId: uuid }),
  // "never" has no number of days; the other two need one (checked in the refine below).
  z.object({ type: z.literal('last_inbound'), op: z.enum(['within', 'not_within', 'never']), days: days.optional() }),
  z.object({ type: z.literal('added'), op: z.enum(['within', 'before']), days }),
  z.object({ type: z.literal('campaign'), op: z.enum(CAMPAIGN_OUTCOMES), campaignId: uuid }),
]).refine((r) => r.type !== 'last_inbound' || r.op === 'never' || r.days !== undefined, { message: 'Enter the number of days.' });
export type SegmentRule = z.infer<typeof segmentRule>;

export const segmentFilter = z.object({ match: z.enum(['all', 'any']), rules: z.array(segmentRule).min(1, 'Add at least one rule.').max(15, 'A segment can have 15 rules at most.') });
export type SegmentFilter = z.infer<typeof segmentFilter>;

/** Plain-language text for one rule, shown on the group card. `names` maps ids to readable names. */
export function describeRule(r: SegmentRule, names: { campaigns?: Record<string, string>; sources?: Record<string, string> } = {}): string {
  switch (r.type) {
    case 'tag': return r.op === 'has' ? `has the tag “${r.value}”` : `does not have the tag “${r.value}”`;
    case 'lead_status': return `${r.op === 'is' ? 'has a lead that is' : 'has no lead that is'} ${r.values.join(' or ')}`;
    case 'lead_source': return `${r.op === 'is' ? 'came from' : 'did not come from'} ${names.sources?.[r.sourceId] ?? 'a lead source'}`;
    case 'last_inbound': return r.op === 'never' ? 'has never messaged you' : r.op === 'within' ? `messaged you in the last ${r.days} days` : `has not messaged you in the last ${r.days} days`;
    case 'added': return r.op === 'within' ? `was added in the last ${r.days} days` : `was added more than ${r.days} days ago`;
    case 'campaign': {
      const n = names.campaigns?.[r.campaignId] ?? 'a bulk send';
      const t: Record<(typeof CAMPAIGN_OUTCOMES)[number], string> = { received: `received “${n}”`, read: `read “${n}”`, replied: `replied to “${n}”`, not_read: `got “${n}” but did not read it`, not_replied: `got “${n}” but did not reply`, failed: `did not receive “${n}” (failed)` };
      return t[r.op];
    }
  }
}

/** Parses whatever is stored; returns null for a broken/old shape so a bad row can never widen an audience. */
export function parseSegmentFilter(raw: unknown): SegmentFilter | null {
  const p = segmentFilter.safeParse(raw);
  return p.success ? p.data : null;
}
