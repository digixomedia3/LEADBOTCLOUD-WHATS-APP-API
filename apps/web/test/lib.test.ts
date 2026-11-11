import { describe, expect, it } from 'vitest';
import { estimateCost } from '../src/lib/cost';
import { lintFormat, variablesOf } from '../src/lib/format-lint';
import { inr, pct } from '../src/lib/format';

describe('estimateCost', () => {
  it('1,240 promotional messages with 18% GST', () => {
    const c = estimateCost(1240, 'marketing');
    expect(c.subtotalPaise).toBe(107024); // 1240 x 0.8631 INR = 1,070.24 INR
    expect(c.gstPaise).toBe(19264);
    expect(c.totalPaise).toBe(c.subtotalPaise + c.gstPaise);
  });
  it('zero and negative counts cost nothing', () => {
    expect(estimateCost(0, 'utility').totalPaise).toBe(0);
    expect(estimateCost(-5, 'utility').totalPaise).toBe(0);
  });
});

describe('format helpers', () => {
  it('formats rupees with Indian grouping', () => {
    expect(inr(10000000)).toContain('1,00,000');
  });
  it('percentages never divide by zero', () => {
    expect(pct(1, 0)).toBe('0%');
    expect(pct(1, 4)).toBe('25%');
  });
});

describe('lintFormat', () => {
  const base = { name: 'renewal_reminder', category: 'marketing' as const, samples: { '1': 'Asha' } };
  it('flags a variable at the start or end', () => {
    const r = lintFormat({ ...base, body: '{{1}} your plan ends soon, renew now {{1}}' });
    expect(r.issues.some((i) => i.level === 'error' && /starts or ends/.test(i.text))).toBe(true);
    expect(r.risk).toBe('high');
  });
  it('flags adjacent variables and missing samples', () => {
    const r = lintFormat({ ...base, samples: {}, body: 'Hello {{1}}{{2}} welcome to our shop today' });
    expect(r.issues.some((i) => /next to each other/.test(i.text))).toBe(true);
    expect(r.issues.some((i) => /example for/.test(i.text))).toBe(true);
  });
  it('warns that renewal wording marked as Update becomes Promotional', () => {
    const r = lintFormat({ ...base, category: 'utility', body: 'Hi {{1}}, your plan expires on Friday. Please renew soon.' });
    expect(r.predictedCategory).toBe('marketing');
    expect(r.risk).toBe('medium');
  });
  it('rejects short links and bad names', () => {
    const r = lintFormat({ ...base, name: 'Bad Name', body: 'Hi {{1}}, see https://bit.ly/abc for more details today' });
    expect(r.issues.filter((i) => i.level === 'error').length).toBeGreaterThanOrEqual(2);
  });
  it('passes a clean promotional message', () => {
    const r = lintFormat({ ...base, name: 'diwali_offer', body: 'Hi {{1}}, our Diwali sale is on with 20% off all plans till Sunday. Reply YES to know more.' });
    expect(r.risk).toBe('low');
  });
  it('lists unique variables', () => {
    expect(variablesOf('a {{1}} b {{2}} c {{1}}')).toEqual(['1', '2']);
  });
});
