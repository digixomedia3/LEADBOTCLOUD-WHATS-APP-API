/**
 * A/B test maths for campaigns. Pure functions, so every verdict on the report page is tested.
 *
 * Two templates are sent to two random halves of the same audience. Each person is counted once, in the version they got.
 * The report must never say "B won" because of luck: with few people, a gap of a few messages means nothing. So a verdict needs
 *  - enough people who actually received each version (MIN_PER_VERSION), and
 *  - a difference too big to be chance at about 95% confidence (a two-sided two-proportion z-test).
 * Otherwise it says so plainly ("too early" or "no clear difference").
 */
import { createHash } from 'node:crypto';

export const MIN_PER_VERSION = 50;
export const MIN_SPLIT = 10;
export const MAX_SPLIT = 90;
const Z_95 = 1.96;

/**
 * Which people get version B. The same people always get the same version for the same campaign (so a retry cannot swap anyone),
 * the choice looks random, and the split is exact: with 10 people at 30% exactly 3 get B, never 1 or 5 by bad luck.
 */
export function assignVersionB(contactIds: readonly string[], campaignId: string, percentB: number): Set<string> {
  const pct = Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, Math.round(percentB)));
  const want = Math.round((contactIds.length * pct) / 100);
  const keyed = contactIds.map((id) => ({ id, k: createHash('sha256').update(`${campaignId}:${id}`).digest('hex') }));
  keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.id < b.id ? -1 : 1));
  return new Set(keyed.slice(0, want).map((x) => x.id));
}

export interface VersionCounts { received: number; delivered: number; read: number; replied: number }
export type Verdict = 'too_early' | 'no_clear_difference' | 'a_better' | 'b_better';
export interface MetricResult { rateA: number | null; rateB: number | null; verdict: Verdict; /** Percentage points, B minus A; null when a rate is missing. */ diffPoints: number | null }

const rate = (n: number, d: number): number | null => (d > 0 ? n / d : null);

/** Two-sided z-test for two proportions, pooled. Returns |z|, or 0 when it cannot be computed. */
export function zScore(x1: number, n1: number, x2: number, n2: number): number {
  if (n1 <= 0 || n2 <= 0) return 0;
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return 0;
  return Math.abs((x2 / n2 - x1 / n1) / se);
}

function metric(xa: number, na: number, xb: number, nb: number): MetricResult {
  const rateA = rate(xa, na), rateB = rate(xb, nb);
  const diffPoints = rateA === null || rateB === null ? null : Math.round((rateB - rateA) * 1000) / 10;
  if (na < MIN_PER_VERSION || nb < MIN_PER_VERSION) return { rateA, rateB, verdict: 'too_early', diffPoints };
  if (zScore(xa, na, xb, nb) < Z_95) return { rateA, rateB, verdict: 'no_clear_difference', diffPoints };
  return { rateA, rateB, verdict: rateB! > rateA! ? 'b_better' : 'a_better', diffPoints };
}

export interface AbResult { read: MetricResult; reply: MetricResult }

/** Read rate and reply rate are both measured against people the message was DELIVERED to, so a version is not punished for messages that never arrived. */
export function compareVersions(a: VersionCounts, b: VersionCounts): AbResult {
  return { read: metric(a.read, a.delivered, b.read, b.delivered), reply: metric(a.replied, a.delivered, b.replied, b.delivered) };
}

/** Plain-words summary for the report. Only calls a winner when the evidence is there, and says which measure it is about. */
export function abHeadline(r: AbResult, nameA: string, nameB: string): string {
  const w = (m: MetricResult) => (m.verdict === 'a_better' ? nameA : m.verdict === 'b_better' ? nameB : null);
  const read = w(r.read), reply = w(r.reply);
  if (r.read.verdict === 'too_early' && r.reply.verdict === 'too_early') return `Too early to tell. Each version needs at least ${MIN_PER_VERSION} delivered messages before a difference means anything.`;
  if (read && reply && read === reply) return `${read} is doing better, on both reads and replies.`;
  if (read && reply) return `Mixed result: ${read} gets more reads, ${reply} gets more replies. Decide which matters more to you.`;
  if (read) return `${read} gets more reads. Replies show no clear difference.`;
  if (reply) return `${reply} gets more replies. Reads show no clear difference.`;
  return 'No clear difference between the two versions. Any gap you see could be chance.';
}
