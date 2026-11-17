import { describe, expect, it } from 'vitest';
import { BASE_SCORE, DEFAULT_WEIGHTS, HOT_FROM, MAX_IDLE_WEIGHT, MAX_WEIGHT, WARM_FROM, WEIGHT_KEYS, bandFor, parseWeights, scoreHeadline, scoreLead, weightsProblem, type LeadSignals } from '../src/lead-score';

const NOW = new Date('2026-11-17T12:00:00Z');
const DAY = 86_400_000;
const sig = (o: Partial<LeadSignals> = {}): LeadSignals => ({ status: 'new', consent: 'unknown', replies: 0, reads: 0, clicks: 0, hasEmail: false, valuePaise: 0, submissions: 1, lastActivityAt: NOW, now: NOW, ...o });
const total = (s: ReturnType<typeof scoreLead>) => s.reasons.reduce((n, r) => n + r.points, 0);

describe('fixed outcomes', () => {
  it('won is 100 and closed leads are 0, whatever else is true', () => {
    expect(scoreLead(sig({ status: 'won', consent: 'stopped' }))).toMatchObject({ score: 100, band: 'won' });
    for (const st of ['lost', 'junk']) expect(scoreLead(sig({ status: st, replies: 5, reads: 3, clicks: 2, consent: 'allowed', hasEmail: true, valuePaise: 1e9 }))).toMatchObject({ score: 0, band: 'closed' });
  });
  it('outcomes ignore the workspace weights, so a closed lead can never be tuned into looking hot', () => {
    const big = { ...DEFAULT_WEIGHTS, reply: 50, read: 50, click: 50 };
    expect(scoreLead(sig({ status: 'lost', replies: 2, clicks: 1 }), big).score).toBe(0); expect(scoreLead(sig({ status: 'won' }), { ...DEFAULT_WEIGHTS, reply: 0 }).score).toBe(100);
  });
  it('an opted-out person is at most 5 and cold, with the reason shown', () => {
    const s = scoreLead(sig({ consent: 'stopped', replies: 2, reads: 1, clicks: 1, hasEmail: true, valuePaise: 100 })); expect(s.score).toBeLessThanOrEqual(5); expect(s.band).toBe('cold');
    expect(s.reasons.some((r) => /Opted out/.test(r.label))).toBe(true);
  });
});

describe('building a score', () => {
  it('a brand-new lead with nothing else starts at the base score and is cold', () => { const s = scoreLead(sig()); expect(s.score).toBe(BASE_SCORE); expect(s.band).toBe('cold'); expect(s.reasons).toEqual([{ label: 'Starting point', points: BASE_SCORE }]); });
  it('each signal adds exactly its weight', () => {
    const w = DEFAULT_WEIGHTS;
    expect(scoreLead(sig({ replies: 1 })).score).toBe(BASE_SCORE + w.reply);
    expect(scoreLead(sig({ reads: 4 })).score).toBe(BASE_SCORE + w.read);          // reading counts once however many
    expect(scoreLead(sig({ clicks: 3 })).score).toBe(BASE_SCORE + w.click);        // so does clicking
    expect(scoreLead(sig({ consent: 'allowed' })).score).toBe(BASE_SCORE + w.agreed);
    expect(scoreLead(sig({ hasEmail: true })).score).toBe(BASE_SCORE + w.email);
    expect(scoreLead(sig({ valuePaise: 1 })).score).toBe(BASE_SCORE + w.value);
    expect(scoreLead(sig({ status: 'contacted' })).score).toBe(BASE_SCORE + w.contacted);
    expect(scoreLead(sig({ status: 'qualified' })).score).toBe(BASE_SCORE + w.qualified);
  });
  it('replies count up to two, and coming back again up to two extra times', () => {
    const w = DEFAULT_WEIGHTS;
    expect(scoreLead(sig({ replies: 2 })).score).toBe(BASE_SCORE + 2 * w.reply); expect(scoreLead(sig({ replies: 9 })).score).toBe(BASE_SCORE + 2 * w.reply);
    expect(scoreLead(sig({ submissions: 2 })).score).toBe(BASE_SCORE + w.resubmit); expect(scoreLead(sig({ submissions: 3 })).score).toBe(BASE_SCORE + 2 * w.resubmit); expect(scoreLead(sig({ submissions: 50 })).score).toBe(BASE_SCORE + 2 * w.resubmit);
  });
  it('a first form fill adds nothing for "came back", and nonsense counts are ignored', () => {
    expect(scoreLead(sig({ submissions: 1 })).score).toBe(BASE_SCORE); expect(scoreLead(sig({ submissions: 0 })).score).toBe(BASE_SCORE); expect(scoreLead(sig({ replies: -3 })).score).toBe(BASE_SCORE);
  });
  it('is capped at 100 and never below 0', () => {
    const max = { ...DEFAULT_WEIGHTS, reply: 50, read: 50, click: 50, agreed: 50, email: 50, value: 50, resubmit: 50, contacted: 50, qualified: 50 };
    expect(scoreLead(sig({ status: 'qualified', consent: 'allowed', replies: 2, reads: 1, clicks: 1, hasEmail: true, valuePaise: 1, submissions: 5 }), max).score).toBe(100);
    expect(scoreLead(sig({ lastActivityAt: new Date(NOW.getTime() - 400 * DAY) }), { ...DEFAULT_WEIGHTS, idle: 20 }).score).toBe(0);
  });
  it('every reason adds up to the score, so nothing is hidden', () => {
    for (const o of [sig(), sig({ replies: 2, consent: 'allowed', hasEmail: true }), sig({ status: 'qualified', clicks: 1, reads: 1, submissions: 3, valuePaise: 5 }), sig({ lastActivityAt: new Date(NOW.getTime() - 21 * DAY), consent: 'allowed' })]) {
      const s = scoreLead(o); expect(total(s)).toBe(s.score);
    }
  });
});

describe('going quiet', () => {
  const ago = (days: number, o: Partial<LeadSignals> = {}) => scoreLead(sig({ lastActivityAt: new Date(NOW.getTime() - days * DAY), consent: 'allowed', hasEmail: true, ...o }));
  it('nothing is taken off in the first week', () => { expect(ago(0).score).toBe(ago(6.9).score); });
  it('five points per full week, then it stops at five weeks', () => {
    const base = ago(0).score; expect(ago(7).score).toBe(base - 5); expect(ago(14).score).toBe(base - 10); expect(ago(35).score).toBe(base - 25); expect(ago(400).score).toBe(base - 25);
  });
  it('says how long, in words', () => { expect(ago(7).reasons.at(-1)!.label).toBe('Quiet for 1 week'); expect(ago(15).reasons.at(-1)!.label).toBe('Quiet for 2 weeks'); });
  it('a future "last activity" (clock difference) takes nothing off', () => { expect(ago(-3).score).toBe(ago(0).score); });
});

describe('bands and headlines', () => {
  it('draws the lines exactly at 40 and 70', () => { expect(bandFor(WARM_FROM - 1)).toBe('cold'); expect(bandFor(WARM_FROM)).toBe('warm'); expect(bandFor(HOT_FROM - 1)).toBe('warm'); expect(bandFor(HOT_FROM)).toBe('hot'); expect(bandFor(100)).toBe('hot'); expect(bandFor(0)).toBe('cold'); });
  it('a lead that replied, agreed and clicked is hot; one that only left a number is cold', () => {
    expect(scoreLead(sig({ replies: 1, clicks: 1, consent: 'allowed', hasEmail: true })).band).toBe('hot');
    expect(scoreLead(sig()).band).toBe('cold');
  });
  it('headlines match the band', () => { expect(scoreHeadline(scoreLead(sig({ status: 'won' })))).toBe('Won.'); expect(scoreHeadline(scoreLead(sig({ status: 'lost' })))).toMatch(/Closed/); expect(scoreHeadline(scoreLead(sig()))).toMatch(/^Cold/); });
});

describe('weights', () => {
  it('changing a weight changes the score by that amount', () => { expect(scoreLead(sig({ replies: 1 }), { ...DEFAULT_WEIGHTS, reply: 40 }).score).toBe(BASE_SCORE + 40); expect(scoreLead(sig({ replies: 1 }), { ...DEFAULT_WEIGHTS, reply: 0 }).score).toBe(BASE_SCORE); });
  it('a signal worth zero is left out of the explanation', () => { expect(scoreLead(sig({ replies: 1 }), { ...DEFAULT_WEIGHTS, reply: 0 }).reasons.some((r) => /Replied/.test(r.label))).toBe(false); });
  it('reads stored weights, and any bad, missing or out-of-range value falls back to the default for that one signal', () => {
    expect(parseWeights(null)).toEqual(DEFAULT_WEIGHTS); expect(parseWeights('x')).toEqual(DEFAULT_WEIGHTS); expect(parseWeights([1, 2])).toEqual(DEFAULT_WEIGHTS);
    const w = parseWeights({ reply: 30, read: -1, click: 1.5, agreed: '10', email: MAX_WEIGHT + 1, idle: MAX_IDLE_WEIGHT + 1, value: 0 });
    expect(w).toMatchObject({ reply: 30, value: 0, read: DEFAULT_WEIGHTS.read, click: DEFAULT_WEIGHTS.click, agreed: DEFAULT_WEIGHTS.agreed, email: DEFAULT_WEIGHTS.email, idle: DEFAULT_WEIGHTS.idle });
    expect(parseWeights({ idle: MAX_IDLE_WEIGHT }).idle).toBe(MAX_IDLE_WEIGHT);
  });
  it('checks weights a person types in, with the rule named in the message', () => {
    expect(weightsProblem({ ...DEFAULT_WEIGHTS })).toBeNull();
    expect(weightsProblem({ ...DEFAULT_WEIGHTS, reply: 51 })).toMatch(/Replied.*between 0 and 50/); expect(weightsProblem({ ...DEFAULT_WEIGHTS, idle: 21 })).toMatch(/between 0 and 20/);
    expect(weightsProblem({ ...DEFAULT_WEIGHTS, read: -1 })).toMatch(/between 0/); expect(weightsProblem({ ...DEFAULT_WEIGHTS, click: 2.5 })).toMatch(/whole number/); expect(weightsProblem({ ...DEFAULT_WEIGHTS, email: '5' })).toMatch(/whole number/);
    const missing: Record<string, number> = { ...DEFAULT_WEIGHTS }; delete missing.value; expect(weightsProblem(missing)).toMatch(/Has a deal value/);
    expect(weightsProblem({ ...DEFAULT_WEIGHTS, sneaky: 5 })).toMatch(/Unknown/); expect(weightsProblem(null)).not.toBeNull(); expect(weightsProblem([])).not.toBeNull();
  });
  it('the defaults cover every signal once', () => { expect(WEIGHT_KEYS.length).toBe(Object.keys(DEFAULT_WEIGHTS).length); expect(new Set(WEIGHT_KEYS).size).toBe(WEIGHT_KEYS.length); });
});
