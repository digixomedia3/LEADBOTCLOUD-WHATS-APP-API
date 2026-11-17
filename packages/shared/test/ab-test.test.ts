import { describe, expect, it } from 'vitest';
import { MAX_SPLIT, MIN_PER_VERSION, MIN_SPLIT, abHeadline, assignVersionB, compareVersions, zScore, type VersionCounts } from '../src/ab-test';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `contact-${i}`);
const v = (delivered: number, read: number, replied: number): VersionCounts => ({ received: delivered, delivered, read, replied });

describe('assigning people to version B', () => {
  it('gives exactly the share asked for, never more or less by luck', () => {
    for (const [n, pct, want] of [[10, 30, 3], [100, 50, 50], [101, 50, 51], [1000, 20, 200], [7, 50, 4], [3, 10, 0]] as const) expect(assignVersionB(ids(n), 'camp-1', pct).size, `${n} at ${pct}%`).toBe(want);
  });
  it('is stable: the same campaign always sends the same people the same version, whatever order they arrive in', () => {
    const a = assignVersionB(ids(200), 'camp-1', 50); const shuffled = [...ids(200)].reverse();
    expect([...assignVersionB(shuffled, 'camp-1', 50)].sort()).toEqual([...a].sort());
  });
  it('differs between campaigns, so the same people are not always the B group', () => {
    const a = assignVersionB(ids(200), 'camp-1', 50), b = assignVersionB(ids(200), 'camp-2', 50);
    const overlap = [...a].filter((x) => b.has(x)).length; expect(overlap).toBeGreaterThan(30); expect(overlap).toBeLessThan(70);   // independent halves of 200 overlap by about 50; identical groups would overlap by 100
  });
  it('does not favour early or late ids (looks random)', () => {
    const b = assignVersionB(ids(1000), 'camp-9', 50); const firstHalf = ids(500).filter((x) => b.has(x)).length;
    expect(firstHalf).toBeGreaterThan(210); expect(firstHalf).toBeLessThan(290);   // 500 of 1000 are B, so about 250 of the first 500 ids
  });
  it('keeps the split between 10% and 90%, whatever is asked', () => {
    expect(assignVersionB(ids(100), 'c', 0).size).toBe(MIN_SPLIT); expect(assignVersionB(ids(100), 'c', 100).size).toBe(MAX_SPLIT); expect(assignVersionB(ids(100), 'c', -5).size).toBe(MIN_SPLIT);
  });
  it('handles nobody, and never assigns a person twice or someone who was not in the list', () => {
    expect(assignVersionB([], 'c', 50).size).toBe(0);
    const list = ids(50); const b = assignVersionB(list, 'c', 40); expect([...b].every((x) => list.includes(x))).toBe(true); expect(b.size).toBe(20);
  });
});

describe('z score', () => {
  it('is zero for identical rates, for empty groups and when nobody (or everybody) succeeded', () => {
    expect(zScore(10, 100, 10, 100)).toBe(0); expect(zScore(0, 0, 5, 10)).toBe(0); expect(zScore(0, 100, 0, 100)).toBe(0); expect(zScore(100, 100, 100, 100)).toBe(0);
  });
  it('matches a hand-worked example: 30/100 vs 45/100, pooled p = 0.375, SE = 0.0685, z = 2.19', () => { expect(zScore(30, 100, 45, 100)).toBeCloseTo(2.19, 2); });
  it('is the same whichever version is better (it only measures the size of the gap)', () => { expect(zScore(45, 100, 30, 100)).toBeCloseTo(zScore(30, 100, 45, 100), 10); });
});

describe('verdicts', () => {
  it('says too early until each version has enough delivered messages', () => {
    const r = compareVersions(v(MIN_PER_VERSION - 1, 40, 20), v(500, 100, 10)); expect(r.read.verdict).toBe('too_early'); expect(r.reply.verdict).toBe('too_early');
    expect(compareVersions(v(500, 100, 10), v(MIN_PER_VERSION - 1, 40, 20)).read.verdict).toBe('too_early');
    expect(compareVersions(v(0, 0, 0), v(0, 0, 0)).read).toMatchObject({ verdict: 'too_early', rateA: null, rateB: null, diffPoints: null });
  });
  it('does not call a winner on a gap that could be luck', () => {
    expect(compareVersions(v(100, 50, 10), v(100, 56, 14)).read.verdict).toBe('no_clear_difference');      // 50% vs 56% of 100: z about 0.85
    expect(compareVersions(v(60, 30, 6), v(60, 36, 9)).reply.verdict).toBe('no_clear_difference');
  });
  it('calls the better version when the gap is too large for chance, in either direction', () => {
    expect(compareVersions(v(200, 60, 5), v(200, 100, 5)).read.verdict).toBe('b_better');
    expect(compareVersions(v(200, 100, 5), v(200, 60, 5)).read.verdict).toBe('a_better');
    expect(compareVersions(v(300, 150, 10), v(300, 150, 40)).reply.verdict).toBe('b_better');
  });
  it('reports the gap in percentage points, B minus A', () => {
    expect(compareVersions(v(200, 60, 5), v(200, 100, 5)).read).toMatchObject({ rateA: 0.3, rateB: 0.5, diffPoints: 20 });
    expect(compareVersions(v(200, 100, 5), v(200, 60, 5)).read.diffPoints).toBe(-20);
  });
  it('measures read and reply separately', () => {
    const r = compareVersions(v(200, 100, 10), v(200, 100, 60)); expect(r.read.verdict).toBe('no_clear_difference'); expect(r.reply.verdict).toBe('b_better');
  });
  it('sits right at the edge of 95%: just under is not called, just over is', () => {
    // 200 each, A at 50%: B at 58% is z about 1.6, B at 60% is z about 2.0
    expect(compareVersions(v(200, 100, 0), v(200, 116, 0)).read.verdict).toBe('no_clear_difference');
    expect(compareVersions(v(200, 100, 0), v(200, 120, 0)).read.verdict).toBe('b_better');
  });
});

describe('rates are of delivered messages, not of everything sent', () => {
  it('a version is not punished for messages that never arrived', () => {
    // A: 300 messaged, only 100 delivered, 50 read (50%).  B: 100 messaged, 100 delivered, 50 read (50%).  Same real read rate.
    const a: VersionCounts = { received: 300, delivered: 100, read: 50, replied: 10 }, b: VersionCounts = { received: 100, delivered: 100, read: 50, replied: 10 };
    const r = compareVersions(a, b); expect(r.read).toMatchObject({ rateA: 0.5, rateB: 0.5, diffPoints: 0, verdict: 'no_clear_difference' }); expect(r.reply).toMatchObject({ rateA: 0.1, rateB: 0.1 });
  });
  it('the number of people needed is counted in delivered messages too', () => {
    const r = compareVersions({ received: 500, delivered: 10, read: 9, replied: 0 }, { received: 500, delivered: 500, read: 100, replied: 0 });
    expect(r.read.verdict).toBe('too_early');   // 500 were messaged but only 10 got it: not enough to judge
  });
});

describe('headline', () => {
  const A = 'Festival offer', B = 'Short offer';
  it('says too early when both measures are too early', () => { expect(abHeadline(compareVersions(v(10, 5, 1), v(10, 6, 1)), A, B)).toMatch(/^Too early to tell/); });
  it('names the winner only when the evidence is there', () => {
    expect(abHeadline(compareVersions(v(200, 60, 5), v(200, 100, 5)), A, B)).toBe(`${B} gets more reads. Replies show no clear difference.`);
    expect(abHeadline(compareVersions(v(200, 100, 5), v(200, 60, 5)), A, B)).toContain(A);
  });
  it('is honest about a mixed result', () => {
    expect(abHeadline(compareVersions(v(300, 200, 10), v(300, 120, 60)), A, B)).toBe(`Mixed result: ${A} gets more reads, ${B} gets more replies. Decide which matters more to you.`);
  });
  it('says both when one version wins on everything, and says nothing is clear when nothing is', () => {
    expect(abHeadline(compareVersions(v(300, 100, 10), v(300, 200, 60)), A, B)).toBe(`${B} is doing better, on both reads and replies.`);
    expect(abHeadline(compareVersions(v(100, 50, 10), v(100, 52, 11)), A, B)).toMatch(/^No clear difference/);
  });
});
