import { describe, expect, it } from 'vitest';
import { lintTemplate, renderPreview, variablesIn, explainRejection, type TemplateDraft } from '../src/template-lint';

const base: TemplateDraft = { name: 'renewal_notice', category: 'marketing', body: 'Hi {{1}}, your plan ends on {{2}}. Renew today to keep your access.', footer: 'Reply STOP to opt out', buttons: [], samples: ['Asha', '30 Nov'] };
const msgs = (d: Partial<TemplateDraft>, names: string[] = [], bodies: string[] = []) => lintTemplate({ ...base, ...d }, names, bodies);

describe('lintTemplate hard checks', () => {
  it('passes a good marketing template with no blocks', () => {
    const r = msgs({});
    expect(r.blocked).toBe(false);
  });
  it('rejects bad names and duplicate names', () => {
    expect(msgs({ name: 'Diwali Offer' }).blocked).toBe(true);
    expect(msgs({}, ['renewal_notice']).issues.some((i) => /already have/.test(i.message))).toBe(true);
  });
  it('blocks variables at the start, at the end and next to each other', () => {
    expect(msgs({ body: '{{1}} your plan ends soon for you', samples: ['A'] }).blocked).toBe(true);
    expect(msgs({ body: 'Your plan ends on {{1}}', samples: ['A'] }).blocked).toBe(true);
    expect(msgs({ body: 'Hello {{1}}{{2}} welcome back to the club', samples: ['A', 'B'] }).blocked).toBe(true);
  });
  it('blocks skipped variable numbers and missing samples', () => {
    expect(msgs({ body: 'Hi {{1}}, pay {{3}} now to continue with us', samples: ['A', 'B'] }).issues.some((i) => /in order/.test(i.message))).toBe(true);
    expect(msgs({ samples: ['Asha'] }).issues.some((i) => i.field === 'samples' && i.level === 'block')).toBe(true);
  });
  it('blocks leading/trailing whitespace and double blank lines', () => {
    expect(msgs({ body: ' Hello there, welcome to the club today.' }).blocked).toBe(true);
    expect(msgs({ body: 'Hello there.\n\n\nWelcome to the club today.' }).blocked).toBe(true);
  });
  it('enforces length limits', () => {
    expect(msgs({ body: 'a'.repeat(1025) }).blocked).toBe(true);
    expect(msgs({ headerText: 'h'.repeat(61) }).blocked).toBe(true);
    expect(msgs({ footer: 'f'.repeat(61) }).blocked).toBe(true);
  });
  it('validates buttons: counts, https, shorteners, grouping', () => {
    const url = { type: 'url' as const, text: 'Pay', value: 'https://pay.example.com/{{1}}' };
    expect(msgs({ buttons: [url] }).issues.filter((i) => i.field === 'buttons' && i.level === 'block')).toHaveLength(0);
    expect(msgs({ buttons: [{ type: 'url', text: 'Pay', value: 'http://x.com' }] }).blocked).toBe(true);
    expect(msgs({ buttons: [{ type: 'url', text: 'Pay', value: 'https://bit.ly/abc' }] }).blocked).toBe(true);
    expect(msgs({ buttons: [url, url, url] }).blocked).toBe(true);
    const qr = { type: 'quick_reply' as const, text: 'Stop' };
    expect(msgs({ buttons: [qr, url, qr] }).blocked).toBe(true);
    expect(msgs({ buttons: [qr, qr, url] }).blocked).toBe(false);
  });
  it('blocks banned wording', () => {
    expect(msgs({ body: 'Join our shared login plan for cheap streaming access.' }).blocked).toBe(true);
  });
  it('blocks a near-duplicate body', () => {
    expect(msgs({}, [], ['Hi {{1}}, your plan ends on {{2}}. Renew today to keep your access.']).blocked).toBe(true);
  });
});

describe('category guidance', () => {
  it('warns that promotional wording in a Utility template becomes Marketing', () => {
    const r = msgs({ category: 'utility', body: 'Hi {{1}}, enjoy a 20% discount on your next order with us today.', samples: ['Asha'] });
    expect(r.suggestedCategory).toBe('marketing');
    expect(r.issues.some((i) => /Promotional/.test(i.message))).toBe(true);
  });
  it('warns marketing without an opt-out', () => {
    expect(msgs({ footer: '' }).issues.some((i) => /Stop promotions/.test(i.message))).toBe(true);
  });
  it('authentication needs a copy-code button and no links or emoji', () => {
    const r = msgs({ category: 'authentication', body: 'Your code is {{1}}. Do not share it 😀 https://x.com for anything.', samples: ['123456'], buttons: [] });
    expect(r.issues.filter((i) => i.level === 'block').length).toBeGreaterThanOrEqual(3);
  });
  it('risk goes up with issues', () => {
    expect(msgs({}).risk).toBe('low');
    expect(msgs({ name: 'BAD NAME' }).risk).toBe('high');
  });
});

describe('helpers', () => {
  it('lists variables and renders previews', () => {
    expect(variablesIn('a {{1}} b {{ 2 }}')).toEqual([1, 2]);
    expect(renderPreview('Hi {{1}}, due {{2}}', ['Asha'])).toBe('Hi Asha, due {{2}}');
  });
  it('explains rejections in plain words', () => {
    expect(explainRejection('PROMOTIONAL')).toMatch(/Promotional/);
    expect(explainRejection(null)).toMatch(/without a specific reason/);
  });
});
