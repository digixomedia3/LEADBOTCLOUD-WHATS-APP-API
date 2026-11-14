import { describe, expect, it } from 'vitest';
import { billedCost, buildFunnel, countRecipients, groupReasons, outcomeBreakdown, recipientCsvRow, RECIPIENT_CSV_HEADER } from '../src/campaign-report';

const many = (s: string, n: number) => Array.from({ length: n }, () => s);
const mixed = [...many('replied', 5), ...many('read', 15), ...many('delivered', 30), ...many('sent', 10), ...many('failed', 4), ...many('capped', 2), ...many('queued', 3), ...many('retry_wait', 1), ...many('skipped', 30)];

describe('counting recipients', () => {
  it('a person counts toward every step they passed through', () => {
    const c = countRecipients(mixed);
    expect(c).toEqual({ considered: 100, skipped: 30, queued: 4, sent: 60, delivered: 50, read: 20, replied: 5, failed: 4, capped: 2 });
  });
  it('an empty campaign is all zeros', () => { expect(countRecipients([])).toEqual({ considered: 0, skipped: 0, queued: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0, capped: 0 }); });
  it('an unknown state counts as considered but as nothing else', () => { const c = countRecipients(['mystery']); expect(c.considered).toBe(1); expect(c.sent + c.failed + c.skipped + c.queued + c.capped).toBe(0); });
});

describe('funnel', () => {
  const f = buildFunnel(countRecipients(mixed));
  it('has the five steps in order, each no bigger than the one before (after the first)', () => {
    expect(f.map((x) => x.key)).toEqual(['considered', 'sent', 'delivered', 'read', 'replied']);
    for (let i = 2; i < f.length; i++) expect(f[i]!.count).toBeLessThanOrEqual(f[i - 1]!.count);
  });
  it('rates are of the previous step, and "sent" is judged against people actually messaged, not skipped ones', () => {
    expect(f[1]).toMatchObject({ count: 60, ofPrevious: 85.7 });            // 60 of the 70 not skipped
    expect(f[2]).toMatchObject({ count: 50, ofPrevious: 83.3, ofSent: 83.3 });
    expect(f[3]).toMatchObject({ count: 20, ofPrevious: 40, ofSent: 33.3 });
    expect(f[4]).toMatchObject({ count: 5, ofPrevious: 25, ofSent: 8.3 });
  });
  it('never divides by zero: nothing sent means no rates, not NaN or Infinity', () => {
    for (const states of [[], many('skipped', 10), many('queued', 5), many('failed', 3)]) {
      for (const s of buildFunnel(countRecipients(states))) { expect(Number.isFinite(s.ofPrevious ?? 0)).toBe(true); expect(Number.isFinite(s.ofSent ?? 0)).toBe(true); }
    }
    expect(buildFunnel(countRecipients(many('skipped', 10)))[1]!.ofPrevious).toBeNull();
    expect(buildFunnel(countRecipients(many('queued', 5)))[2]!.ofPrevious).toBeNull();
  });
  it('a campaign where everyone replied is 100% at every step', () => {
    const g = buildFunnel(countRecipients(many('replied', 7))); for (const s of g.slice(1)) expect(s.ofPrevious).toBe(100);
  });
});

describe('outcome breakdown adds up to everyone in the audience', () => {
  it('for a mixed campaign', () => { const b = outcomeBreakdown(countRecipients(mixed)); expect(b.reduce((n, x) => n + x.count, 0)).toBe(100); expect(b.every((x) => x.count >= 0)).toBe(true); });
  it('for any mix of states (checked over many random campaigns)', () => {
    const states = ['queued', 'retry_wait', 'sent', 'delivered', 'read', 'replied', 'failed', 'skipped', 'capped'];
    let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let t = 0; t < 300; t++) {
      const n = Math.floor(rnd() * 80); const arr = Array.from({ length: n }, () => states[Math.floor(rnd() * states.length)]!);
      const c = countRecipients(arr); const b = outcomeBreakdown(c);
      expect(b.reduce((s, x) => s + x.count, 0)).toBe(n); expect(b.every((x) => x.count >= 0)).toBe(true);
      const f = buildFunnel(c); for (let i = 2; i < f.length; i++) expect(f[i]!.count).toBeLessThanOrEqual(f[i - 1]!.count);
    }
  });
});

describe('billed cost', () => {
  it('uses the rate table per category, adds 18% GST, and keeps integer paise', () => {
    const r = billedCost([{ category: 'marketing', messages: 100 }, { category: 'utility', messages: 40 }]);
    expect(r.lines).toEqual([{ category: 'marketing', messages: 100, rateX100: 8631, amountPaise: 8631 }, { category: 'utility', messages: 40, rateX100: 1150, amountPaise: 460 }]);
    expect(r.basePaise).toBe(9091); expect(r.gstPaise).toBe(1636); expect(r.totalPaise).toBe(10727);
    expect(Number.isInteger(r.totalPaise)).toBe(true);
  });
  it('a category with no known rate is reported as unpriced, never guessed', () => {
    const r = billedCost([{ category: 'marketing', messages: 10 }, { category: 'marketing_lite', messages: 5 }, { category: null, messages: 2 }]);
    expect(r.unpriced).toBe(7); expect(r.lines.filter((l) => l.amountPaise === null)).toHaveLength(2); expect(r.basePaise).toBe(Math.round((10 * 8631) / 100));
  });
  it('nothing billable costs nothing', () => { expect(billedCost([])).toMatchObject({ totalPaise: 0, unpriced: 0, lines: [] }); expect(billedCost([{ category: 'marketing', messages: 0 }]).lines).toEqual([]); });
  it('is case-insensitive about the category', () => { expect(billedCost([{ category: 'MARKETING', messages: 1 }]).basePaise).toBe(86); });
});

describe('why people were not messaged', () => {
  it('groups by state and reason, most common first, and only looks at problem states', () => {
    const g = groupReasons([
      ...many('skipped', 3).map((state) => ({ state, reason: 'Opted out' })), ...many('skipped', 5).map((state) => ({ state, reason: 'No permission on record' })),
      { state: 'failed', reason: 'Not a WhatsApp number' }, { state: 'failed', reason: 'Not a WhatsApp number' }, { state: 'read', reason: 'ignored' }, { state: 'sent', reason: null },
    ]);
    expect(g).toEqual([{ reason: 'No permission on record', state: 'skipped', count: 5 }, { reason: 'Opted out', state: 'skipped', count: 3 }, { reason: 'Not a WhatsApp number', state: 'failed', count: 2 }]);
  });
  it('fills in a plain reason when none was stored', () => {
    expect(groupReasons([{ state: 'failed', reason: null }, { state: 'skipped', reason: '  ' }, { state: 'capped', reason: null }]).map((x) => x.reason).sort()).toEqual(['Held back by a limit', 'Not delivered', 'Skipped']);
  });
});

describe('CSV rows', () => {
  it('match the header, show results in plain words, and give the time in IST', () => {
    const row = recipientCsvRow({ name: 'Asha', phone: '+919876543210', state: 'read', reason: null, sentAt: '2026-11-14T10:00:00Z' });
    expect(row).toHaveLength(RECIPIENT_CSV_HEADER.length); expect(row).toEqual(['Asha', '+919876543210', 'Read', null, '2026-11-14 15:30:00']);
  });
  it('handles missing time, unknown state and a missing name', () => {
    expect(recipientCsvRow({ name: null, phone: '+91', state: 'weird', reason: 'x', sentAt: null })).toEqual([null, '+91', 'weird', 'x', '']);
    expect(recipientCsvRow({ name: 'A', phone: '+91', state: 'sent', reason: null, sentAt: 'not a date' })[4]).toBe('');
  });
});
