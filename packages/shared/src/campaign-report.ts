/**
 * Campaign report maths. Pure functions, so every number on the report page is tested.
 *
 * The funnel is built from what happened to each person, and each step is a subset of the one before it:
 *   people considered -> skipped (not messaged) / messaged -> sent -> delivered -> read -> replied
 * Rates are always "of the previous step that could still have happened", and never divide by zero.
 */
import { RATE_PAISE_X100, GST_PCT } from './cost';

export interface RecipientCounts {
  /** Every person the audience rules picked, including people who were skipped. */
  considered: number;
  skipped: number;
  queued: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  capped: number;
}

/** State -> how far a person got. A person who replied also read and was delivered and sent, so each state counts toward every earlier step. */
export function countRecipients(states: readonly string[]): RecipientCounts {
  const c: RecipientCounts = { considered: states.length, skipped: 0, queued: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0, capped: 0 };
  for (const s of states) {
    if (s === 'skipped') c.skipped++;
    else if (s === 'queued' || s === 'retry_wait') c.queued++;
    else if (s === 'failed') c.failed++;
    else if (s === 'capped') c.capped++;
    else if (s === 'sent') c.sent++;
    else if (s === 'delivered') { c.sent++; c.delivered++; }
    else if (s === 'read') { c.sent++; c.delivered++; c.read++; }
    else if (s === 'replied') { c.sent++; c.delivered++; c.read++; c.replied++; }
  }
  return c;
}

export interface FunnelStep { key: 'considered' | 'sent' | 'delivered' | 'read' | 'replied'; label: string; count: number; /** Share of the previous step, 0 to 100, or null when the previous step is empty. */ ofPrevious: number | null; /** Share of everyone who was actually sent a message, or null when nobody was. */ ofSent: number | null }

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

export function buildFunnel(c: RecipientCounts): FunnelStep[] {
  const messaged = c.considered - c.skipped;
  const steps: [FunnelStep['key'], string, number, number][] = [
    ['considered', 'People in the audience', c.considered, c.considered],
    ['sent', 'Messages sent', c.sent, messaged],
    ['delivered', 'Delivered', c.delivered, c.sent],
    ['read', 'Read', c.read, c.delivered],
    ['replied', 'Replied', c.replied, c.read],
  ];
  return steps.map(([key, label, count, prev], i) => ({ key, label, count, ofPrevious: i === 0 ? null : pct(count, prev), ofSent: key === 'considered' ? null : pct(count, c.sent) }));
}

/** Everything that did not reach a reply, as a plain account: where each person ended up. Adds up to `considered`. */
export function outcomeBreakdown(c: RecipientCounts): { label: string; count: number }[] {
  return [
    { label: 'Replied', count: c.replied },
    { label: 'Read, no reply', count: c.read - c.replied },
    { label: 'Delivered, not read', count: c.delivered - c.read },
    { label: 'Sent, not delivered yet', count: c.sent - c.delivered },
    { label: 'Failed', count: c.failed },
    { label: 'Held back by limits', count: c.capped },
    { label: 'Still waiting to send', count: c.queued },
    { label: 'Skipped', count: c.skipped },
  ];
}

export interface BilledLine { category: string; messages: number; rateX100: number | null; amountPaise: number | null }
export interface CostSummary { lines: BilledLine[]; basePaise: number; gstPaise: number; totalPaise: number; unpriced: number }

/**
 * What the messages Meta marked as billable should cost, using our rate table.
 * This is an ESTIMATE of Meta's charge, not an invoice: Meta's own statement is the authority. A category we have no rate for is counted
 * as "unpriced" instead of being guessed.
 */
export function billedCost(billable: readonly { category: string | null; messages: number }[]): CostSummary {
  const lines: BilledLine[] = [];
  let base = 0, unpriced = 0;
  for (const b of billable) {
    if (b.messages <= 0) continue;
    const cat = (b.category ?? '').toLowerCase();
    const rate = cat in RATE_PAISE_X100 ? RATE_PAISE_X100[cat as keyof typeof RATE_PAISE_X100] : null;
    if (rate === null) { unpriced += b.messages; lines.push({ category: cat || 'unknown', messages: b.messages, rateX100: null, amountPaise: null }); continue; }
    const amount = Math.round((b.messages * rate) / 100);
    base += amount;
    lines.push({ category: cat, messages: b.messages, rateX100: rate, amountPaise: amount });
  }
  const gst = Math.round((base * GST_PCT) / 100);
  return { lines, basePaise: base, gstPaise: gst, totalPaise: base + gst, unpriced };
}

/** Plain-language group name for a stored reason, for the "why" table. Free text from the worker is kept as it is. */
export function groupReasons(rows: readonly { state: string; reason: string | null }[]): { reason: string; state: 'failed' | 'skipped' | 'capped'; count: number }[] {
  const m = new Map<string, { reason: string; state: 'failed' | 'skipped' | 'capped'; count: number }>();
  for (const r of rows) {
    if (r.state !== 'failed' && r.state !== 'skipped' && r.state !== 'capped') continue;
    const reason = (r.reason ?? '').trim() || (r.state === 'skipped' ? 'Skipped' : r.state === 'capped' ? 'Held back by a limit' : 'Not delivered');
    const k = `${r.state}|${reason}`;
    const e = m.get(k);
    if (e) e.count++; else m.set(k, { reason, state: r.state, count: 1 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

/** CSV columns for the recipient export. One place, so the header and the rows cannot drift. */
export const RECIPIENT_CSV_HEADER = ['Name', 'Phone', 'Result', 'Why', 'Sent at (IST)'] as const;
const RESULT_LABEL: Record<string, string> = { queued: 'Waiting to send', retry_wait: 'Waiting to retry', sent: 'Sent', delivered: 'Delivered', read: 'Read', replied: 'Replied', failed: 'Failed', skipped: 'Skipped', capped: 'Held back by a limit' };
export function recipientCsvRow(r: { name: string | null; phone: string; state: string; reason: string | null; sentAt: Date | string | null }): (string | null)[] {
  const t = r.sentAt ? new Date(r.sentAt) : null;
  const ist = t && !Number.isNaN(t.getTime()) ? new Date(t.getTime() + 330 * 60_000).toISOString().replace('T', ' ').slice(0, 19) : '';
  return [r.name, r.phone, RESULT_LABEL[r.state] ?? r.state, r.reason, ist];
}
