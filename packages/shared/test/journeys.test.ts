import { describe, expect, it } from 'vitest';
import { describeMinutes, describeStep, journeyInput, journeyProblem, journeyTemplateProblem, parseSteps, parseTrigger, totalWaitMinutes, type JourneyStep } from '../src/journeys';

const T1 = '11111111-1111-4111-8111-111111111111';
const send = (n = 0): JourneyStep => ({ type: 'send_template', templateId: T1, varMap: Array.from({ length: n }, () => '@name') });
const wait = (minutes: number): JourneyStep => ({ type: 'wait', minutes });
const tag = (t: string): JourneyStep => ({ type: 'add_tag', tag: t });

describe('journey input', () => {
  const ok = { name: 'Welcome series', trigger: { type: 'manual' as const }, steps: [send(1), wait(2880), send(1)] };
  it('accepts a normal journey and defaults stop-on-reply on', () => { const r = journeyInput.parse(ok); expect(r.stopOnReply).toBe(true); expect(r.steps).toHaveLength(3); });
  it('refuses a missing name, no steps, too many steps', () => {
    expect(journeyInput.safeParse({ ...ok, name: ' ' }).success).toBe(false);
    expect(journeyInput.safeParse({ ...ok, steps: [] }).success).toBe(false);
    expect(journeyInput.safeParse({ ...ok, steps: Array.from({ length: 21 }, () => tag('x')) }).success).toBe(false);
  });
  it('refuses silly waits', () => { for (const m of [0, -5, 1.5, 60 * 24 * 60 + 1]) expect(journeyInput.safeParse({ ...ok, steps: [wait(m), send()] }).success, String(m)).toBe(false); });
  it('refuses bad tags and a bad template id', () => {
    for (const t of ['', '   ', 'a,b', 'a;b', 'a\nb', 'x'.repeat(41)]) expect(journeyInput.safeParse({ ...ok, steps: [tag(t), send()] }).success, JSON.stringify(t)).toBe(false);
    expect(journeyInput.safeParse({ ...ok, steps: [{ type: 'send_template', templateId: 'nope', varMap: [] }] }).success).toBe(false);
  });
  it('knows two triggers and refuses others', () => {
    expect(journeyInput.safeParse({ ...ok, trigger: { type: 'lead_created' } }).success).toBe(true);
    expect(journeyInput.safeParse({ ...ok, trigger: { type: 'lead_created', sourceId: T1 } }).success).toBe(true);
    expect(journeyInput.safeParse({ ...ok, trigger: { type: 'lead_created', sourceId: 'x' } }).success).toBe(false);
    expect(journeyInput.safeParse({ ...ok, trigger: { type: 'cron' } }).success).toBe(false);
  });
});

describe('reading stored steps', () => {
  it('reads good steps', () => { expect(parseSteps([wait(5), tag('a'), send()])).toHaveLength(3); });
  it('anything damaged becomes "do nothing", never a half-journey', () => {
    for (const bad of [null, undefined, 'x', {}, [{ type: 'explode' }], [wait(5), { type: 'wait', minutes: -1 }], Array.from({ length: 21 }, () => tag('x'))]) expect(parseSteps(bad), JSON.stringify(bad)).toEqual([]);
  });
  it('an unreadable trigger becomes manual, so nothing is enrolled by accident', () => { expect(parseTrigger({ type: 'weird' })).toEqual({ type: 'manual' }); expect(parseTrigger(null)).toEqual({ type: 'manual' }); expect(parseTrigger({ type: 'lead_created' })).toEqual({ type: 'lead_created' }); });
});

describe('whole-journey rules', () => {
  it('needs a message to send', () => { expect(journeyProblem([tag('a'), wait(10)])).toMatch(/at least one message/); expect(journeyProblem([tag('a')])).toMatch(/at least one message/); });
  it('cannot end on a wait', () => { expect(journeyProblem([send(), wait(60)])).toMatch(/end with a wait/); });
  it('two messages in a row are refused, with a wait between they are fine', () => {
    expect(journeyProblem([send(), send()])).toMatch(/wait between/); expect(journeyProblem([send(), tag('x'), send()])).toBeNull(); expect(journeyProblem([send(), wait(60), send()])).toBeNull();
  });
  it('a plain journey is fine', () => { expect(journeyProblem([send()])).toBeNull(); expect(journeyProblem([tag('new'), send(), wait(1440), send()])).toBeNull(); });
});

describe('which templates can be used', () => {
  const base = { status: 'approved', category: 'marketing', body: 'Hi {{1}}', buttons: [] as { type: string; value?: string }[], offer: null };
  const APP = 'https://panel.example.in';
  it('an ordinary approved template with its blanks filled is fine', () => { expect(journeyTemplateProblem(base, 1, APP, 1)).toBeNull(); expect(journeyTemplateProblem({ ...base, body: 'Hello' }, 0, APP, 0)).toBeNull(); });
  it('refuses one that is not approved', () => { for (const status of ['draft', 'pending', 'rejected', 'paused', 'disabled']) expect(journeyTemplateProblem({ ...base, status }, 1, APP, 1), status).toMatch(/approved/); });
  it('refuses the ones that need a value per campaign: copy code, countdown, tracked link', () => {
    expect(journeyTemplateProblem({ ...base, buttons: [{ type: 'copy_code' }] }, 1, APP, 1)).toMatch(/Copy code/);
    expect(journeyTemplateProblem({ ...base, offer: { hasExpiration: true } }, 1, APP, 1)).toMatch(/countdown/);
    expect(journeyTemplateProblem({ ...base, buttons: [{ type: 'url', value: `${APP}/r/{{1}}` }] }, 1, APP, 1)).toMatch(/tracked link/);
  });
  it('allows an offer without a countdown and an ordinary website button', () => {
    expect(journeyTemplateProblem({ ...base, offer: { hasExpiration: false } }, 1, APP, 1)).toBeNull();
    expect(journeyTemplateProblem({ ...base, buttons: [{ type: 'url', value: 'https://shop.example.com/{{1}}' }] }, 1, APP, 1)).toBeNull();
  });
  it('checks the blanks match', () => { expect(journeyTemplateProblem(base, 2, APP, 1)).toMatch(/2 blanks/); expect(journeyTemplateProblem(base, 1, APP, 0)).toMatch(/1 blank\./); expect(journeyTemplateProblem({ ...base, body: 'Hello' }, 0, APP, 2)).toMatch(/no blanks/); });
});

describe('plain-language descriptions', () => {
  it('minutes', () => { expect([1, 45, 60, 120, 1440, 2880, 90].map(describeMinutes)).toEqual(['1 minute', '45 minutes', '1 hour', '2 hours', '1 day', '2 days', '90 minutes']); });
  it('steps', () => {
    expect(describeStep(wait(2880))).toBe('Wait 2 days'); expect(describeStep(tag('hot'))).toBe('Add the tag “hot”');
    expect(describeStep(send(), { templates: { [T1]: 'Welcome' } })).toBe('Send “Welcome”'); expect(describeStep(send())).toBe('Send “a template”');
  });
  it('total wait adds up', () => { expect(totalWaitMinutes([send(), wait(60), tag('x'), wait(1440), send()])).toBe(1500); expect(totalWaitMinutes([send()])).toBe(0); });
});
