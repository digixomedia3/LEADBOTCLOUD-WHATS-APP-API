import { describe, expect, it } from 'vitest';
import { MAX_TEST_PCT, MIN_TEST_PCT, assignTestGroup, assignVersionB, compareVersions, suggestedWinner, type AbResult, type MetricResult, type VersionCounts } from '../src/ab-test';
import { RELEASE_REASONS } from '../src/release-reasons';
import { buildFunnel, countRecipients, outcomeBreakdown, recipientCsvRow } from '../src/campaign-report';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `contact-${String(i).padStart(4, '0')}`);

describe('choosing the test group', () => {
  it('picks the asked share, rounded, and never anyone twice', () => {
    expect(assignTestGroup(ids(100), 'c1', 20).size).toBe(20); expect(assignTestGroup(ids(40), 'c1', 25).size).toBe(10); expect(assignTestGroup(ids(33), 'c1', 30).size).toBe(10);
  });
  it('is stable: same campaign and people give the same group every time, in any input order', () => {
    const a = assignTestGroup(ids(60), 'camp-x', 20), b = assignTestGroup([...ids(60)].reverse(), 'camp-x', 20); expect([...a].sort()).toEqual([...b].sort());
  });
  it('a different campaign picks a different group, so the same customers are not always the guinea pigs', () => {
    const a = assignTestGroup(ids(200), 'camp-1', 20), b = assignTestGroup(ids(200), 'camp-2', 20); const overlap = [...a].filter((x) => b.has(x)).length;
    expect(overlap).toBeLessThan(a.size * 0.6);
  });
  it('is chosen independently of who would be version B (the test group is not just the B side)', () => {
    const everyone = ids(200); const test = assignTestGroup(everyone, 'camp-1', 50); const b = assignVersionB(everyone, 'camp-1', 50);
    const inBoth = [...test].filter((x) => b.has(x)).length; expect(inBoth).toBeGreaterThan(20); expect(inBoth).toBeLessThan(80);
  });
  it('always at least 2 people, so there is one for each version', () => { expect(assignTestGroup(ids(6), 'c', 10).size).toBe(2); expect(assignTestGroup(ids(9), 'c', 10).size).toBe(2); });
  it('never more than half, so somebody is always left to send the winner to', () => {
    expect(assignTestGroup(ids(4), 'c', 50).size).toBe(2); expect(assignTestGroup(ids(5), 'c', 50).size).toBe(2); expect(assignTestGroup(ids(7), 'c', 50).size).toBe(3);
    for (const n of [2, 3, 4, 5, 8, 9, 50, 101]) expect(assignTestGroup(ids(n), 'c', 50).size).toBeLessThanOrEqual(Math.floor(n / 2));
  });
  it('clamps silly percentages into 10 to 50', () => {
    expect(assignTestGroup(ids(100), 'c', 1).size).toBe(10); expect(assignTestGroup(ids(100), 'c', 99).size).toBe(50); expect(assignTestGroup(ids(100), 'c', -5).size).toBe(10);
    expect(MIN_TEST_PCT).toBe(10); expect(MAX_TEST_PCT).toBe(50);
  });
  it('an empty audience gives an empty group', () => { expect(assignTestGroup([], 'c', 20).size).toBe(0); });
  it('the test group splits exactly half and half into the two versions', () => {
    const test = [...assignTestGroup(ids(200), 'c', 20)]; const b = assignVersionB(test, 'c', 50); expect(b.size).toBe(test.length / 2);
  });
});

const m = (verdict: MetricResult['verdict']): MetricResult => ({ rateA: 0.1, rateB: 0.2, verdict, diffPoints: 10 });
const r = (read: MetricResult['verdict'], reply: MetricResult['verdict']): AbResult => ({ read: m(read), reply: m(reply) });

describe('which version to suggest', () => {
  it('suggests the winner of the reply rate, then the read rate', () => {
    expect(suggestedWinner(r('no_clear_difference', 'b_better'))).toBe('b'); expect(suggestedWinner(r('no_clear_difference', 'a_better'))).toBe('a');
    expect(suggestedWinner(r('a_better', 'no_clear_difference'))).toBe('a'); expect(suggestedWinner(r('b_better', 'too_early'))).toBe('b');
  });
  it('suggests it when both measures agree', () => { expect(suggestedWinner(r('a_better', 'a_better'))).toBe('a'); expect(suggestedWinner(r('b_better', 'b_better'))).toBe('b'); });
  it('suggests nothing when the two measures disagree, because that is the owner\'s call', () => { expect(suggestedWinner(r('a_better', 'b_better'))).toBeNull(); expect(suggestedWinner(r('b_better', 'a_better'))).toBeNull(); });
  it('suggests nothing without evidence', () => {
    expect(suggestedWinner(r('too_early', 'too_early'))).toBeNull(); expect(suggestedWinner(r('no_clear_difference', 'no_clear_difference'))).toBeNull(); expect(suggestedWinner(r('too_early', 'no_clear_difference'))).toBeNull();
  });
  it('works from real counts: a clear gap on big groups is suggested, a small gap on small groups is not', () => {
    const big = (rep: number): VersionCounts => ({ received: 1000, delivered: 1000, read: 600, replied: rep });
    expect(suggestedWinner(compareVersions(big(50), big(120)))).toBe('b'); expect(suggestedWinner(compareVersions(big(100), big(102)))).toBeNull();
    const small: VersionCounts = { received: 10, delivered: 10, read: 5, replied: 1 }; expect(suggestedWinner(compareVersions(small, { ...small, replied: 4 }))).toBeNull();
  });
});

describe('people kept back in the report', () => {
  it('are counted as held, not as skipped, queued or failed', () => {
    const c = countRecipients(['held', 'held', 'held', 'sent', 'delivered', 'skipped']);
    expect(c).toMatchObject({ considered: 6, held: 3, skipped: 1, queued: 0, failed: 0, sent: 2 });
  });
  it('are not "messaged": the funnel percentages are of people actually sent to', () => {
    const c = countRecipients([...Array(8).fill('held'), 'sent', 'delivered']); const f = buildFunnel(c);
    expect(f.find((x) => x.key === 'sent')!.ofPrevious).toBe(100); expect(f[0]!.count).toBe(10);
  });
  it('have their own line in the breakdown, which still adds up to the whole audience', () => {
    const c = countRecipients(['held', 'held', 'sent', 'delivered', 'read', 'replied', 'failed', 'queued', 'skipped', 'capped']);
    const rows = outcomeBreakdown(c); expect(rows.find((x) => x.label === 'Kept back until you pick a winner')!.count).toBe(2);
    expect(rows.reduce((n, x) => n + x.count, 0)).toBe(c.considered);
  });
  it('show a plain label in the CSV export', () => { expect(recipientCsvRow({ name: 'A', phone: '+919000000000', state: 'held', reason: null, sentAt: null })[2]).toBe('Kept back until you pick a winner'); });
});

describe('plain reasons a winner could not be sent', () => {
  it('every reason the worker can write has words for the owner, with something to do next', () => {
    for (const k of ['template_not_approved', 'not_connected', 'reconnect', 'account_restricted', 'payment_banner', 'offer_ended', 'offer_time_missing', 'link_missing', 'app_url_temporary', 'spend_cap', 'offer_code_missing']) {
      expect(RELEASE_REASONS[k], k).toBeTruthy(); expect(RELEASE_REASONS[k]!.length).toBeGreaterThan(30); expect(RELEASE_REASONS[k]).not.toMatch(/\b\d{5,}\b|_/);
    }
  });
});
