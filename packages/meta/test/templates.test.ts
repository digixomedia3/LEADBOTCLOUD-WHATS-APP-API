import { describe, expect, it } from 'vitest';
import { TemplateBuildError, buildTemplatePayload, mapRemoteCategory, mapRemoteQuality, mapRemoteStatus, parseRemoteTemplate, type LocalTemplate } from '../src/templates';

const base: LocalTemplate = { name: 'diwali_offer', language: 'en', category: 'marketing', body: 'Hi {{1}}, enjoy {{2}} on all plans.', samples: ['Asha', '20% off'], buttons: [] };
const err = (t: LocalTemplate) => { try { buildTemplatePayload(t); } catch (e) { return e as TemplateBuildError; } throw new Error('expected build error'); };

describe('buildTemplatePayload (spec 7.1 / 7.2)', () => {
  it('body with variables carries body_text examples and uppercase category', () => {
    const p = buildTemplatePayload(base);
    expect(p).toMatchObject({ name: 'diwali_offer', language: 'en', category: 'MARKETING', parameter_format: 'POSITIONAL' });
    expect(p.components).toEqual([{ type: 'BODY', text: base.body, example: { body_text: [['Asha', '20% off']] } }]);
  });
  it('a body with no variables has no example block', () => {
    expect(buildTemplatePayload({ ...base, body: 'We are open today.', samples: [] }).components).toEqual([{ type: 'BODY', text: 'We are open today.' }]);
  });
  it('orders components HEADER, BODY, FOOTER, BUTTONS', () => {
    const p = buildTemplatePayload({ ...base, headerText: 'Big sale', footer: 'Reply STOP to opt out', buttons: [{ type: 'quick_reply', text: 'Stop promos' }] });
    expect((p.components as { type: string }[]).map((c) => c.type)).toEqual(['HEADER', 'BODY', 'FOOTER', 'BUTTONS']);
  });
  it('maps every supported button type to Meta\'s shape', () => {
    const p = buildTemplatePayload({ ...base, buttons: [
      { type: 'url', text: 'Pay now', value: 'https://rzp.io/l/{{1}}' }, { type: 'url', text: 'Site', value: 'https://example.com' },
      { type: 'phone', text: 'Call us', value: '+91 98765-43210' }, { type: 'copy_code', text: 'Copy', value: 'DIWALI50' }, { type: 'quick_reply', text: 'Stop promos' },
    ] });
    expect((p.components as { type: string; buttons?: unknown[] }[]).find((c) => c.type === 'BUTTONS')!.buttons).toEqual([
      { type: 'URL', text: 'Pay now', url: 'https://rzp.io/l/{{1}}', example: ['https://rzp.io/l/abc123'] },
      { type: 'URL', text: 'Site', url: 'https://example.com' },
      { type: 'PHONE_NUMBER', text: 'Call us', phone_number: '919876543210' },
      { type: 'COPY_CODE', example: 'DIWALI50' },
      { type: 'QUICK_REPLY', text: 'Stop promos' },
    ]);
  });
  it('refuses shapes it cannot build faithfully instead of guessing', () => {
    expect(err({ ...base, category: 'authentication' }).message).toMatch(/not supported/);
    expect(err({ ...base, headerText: 'Hi {{1}}' }).message).toMatch(/header/i);
    expect(err({ ...base, body: 'Hi {{1}} and {{3}}', samples: ['a', 'b'] }).message).toMatch(/numbered 1, 2, 3/);
    expect(err({ ...base, samples: ['Asha'] }).message).toMatch(/sample/i);
    expect(err({ ...base, buttons: [{ type: 'quick_reply', text: 'A' }, { type: 'url', text: 'B', value: 'https://x.co' }, { type: 'quick_reply', text: 'C' }] }).message).toMatch(/together/);
    expect(err({ ...base, buttons: [{ type: 'url', text: 'B' }] }).message).toMatch(/web address/);
    expect(err({ ...base, buttons: [{ type: 'phone', text: 'Call', value: '12' }] }).message).toMatch(/phone number/);
  });
});

describe('remote mapping', () => {
  it('maps known Meta statuses and returns null for unknown ones', () => {
    expect(['PENDING', 'IN_APPEAL', 'APPROVED', 'REINSTATED', 'REJECTED', 'PAUSED', 'DISABLED'].map(mapRemoteStatus)).toEqual(['pending', 'pending', 'approved', 'approved', 'rejected', 'paused', 'disabled']);
    expect(mapRemoteStatus('SOMETHING_NEW')).toBeNull(); expect(mapRemoteStatus(undefined)).toBeNull();
  });
  it('maps quality and category safely', () => {
    expect(['GREEN', 'yellow', 'RED', 'UNKNOWN', undefined].map(mapRemoteQuality)).toEqual(['green', 'yellow', 'red', 'unknown', 'unknown']);
    expect(mapRemoteCategory('UTILITY')).toBe('utility'); expect(mapRemoteCategory('WHATEVER')).toBeNull();
  });
  it('round trip: what we build is read back as the same template', () => {
    const t: LocalTemplate = { ...base, headerText: 'Big sale', footer: 'Reply STOP', buttons: [{ type: 'url', text: 'Pay', value: 'https://rzp.io/l/{{1}}' }, { type: 'quick_reply', text: 'Stop promos' }] };
    const p = buildTemplatePayload(t);
    expect(parseRemoteTemplate({ name: p.name, status: 'APPROVED', category: p.category, language: p.language, components: p.components })).toEqual({ ...t, headerText: 'Big sale' });
  });
  it('does not import what it cannot represent: media header, carousel, authentication', () => {
    const r = (components: unknown[], category = 'MARKETING') => parseRemoteTemplate({ name: 'x', status: 'APPROVED', category, language: 'en', components });
    expect(r([{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'hi' }])).toBeNull();
    expect(r([{ type: 'BODY', text: 'hi' }, { type: 'carousel', cards: [] }])).toBeNull();
    expect(r([{ type: 'BODY', text: 'hi' }], 'AUTHENTICATION')).toBeNull();
    expect(r([{ type: 'FOOTER', text: 'only footer' }])).toBeNull();
  });
});
