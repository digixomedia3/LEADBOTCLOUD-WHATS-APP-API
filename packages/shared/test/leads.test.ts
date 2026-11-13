import { describe, expect, it } from 'vitest';
import { decideConsent, extractLead, flatten, isTruthy, makeLimiter, normKey, parseBody, phoneFromLead } from '../src/leads';

describe('normKey', () => {
  it('makes platform field names comparable', () => {
    expect(['Phone Number', 'phone-number', 'phoneNumber', 'PHONE_NUMBER', ' phone number '].map(normKey)).toEqual(Array(5).fill('phone_number'));
  });
});

describe('flatten', () => {
  it('reads Facebook Lead Ads field_data arrays', () => {
    expect(flatten({ field_data: [{ name: 'full_name', values: ['Asha Verma'] }, { name: 'phone_number', values: ['+919876543210'] }] })).toMatchObject({ full_name: 'Asha Verma', phone_number: '+919876543210' });
  });
  it('reads nested objects with prefixes and ignores empty values', () => {
    const f = flatten({ customer: { phone: '98765 43210', address: { city: 'Lucknow' } }, note: '', n: null });
    expect(f).toMatchObject({ customer_phone: '98765 43210', customer_address_city: 'Lucknow' }); expect(f).not.toHaveProperty('note');
  });
  it('is bounded: long values are cut and deep nesting stops', () => {
    expect(flatten({ a: 'x'.repeat(5000) }).a).toHaveLength(500);
    let o: Record<string, unknown> = { leaf: 'deep' }; for (let i = 0; i < 20; i++) o = { n: o };
    expect(JSON.stringify(flatten(o))).not.toContain('deep');
  });
  it('does not let a prototype key through', () => {
    const f = flatten(JSON.parse('{"__proto__":{"polluted":"yes"},"phone":"1"}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined(); expect(f.phone).toBe('1');
  });
});

describe('parseBody', () => {
  it('parses JSON and urlencoded, and rejects junk', () => {
    expect(parseBody('{"a":1}', 'application/json')).toEqual({ a: 1 });
    expect(parseBody('phone=98765&name=Asha+V', 'application/x-www-form-urlencoded')).toEqual({ phone: '98765', name: 'Asha V' });
    expect(parseBody('{"a":', 'application/json')).toBeNull(); expect(parseBody('hello world', 'text/plain')).toBeNull(); expect(parseBody('   ', undefined)).toBeNull();
  });
});

describe('extractLead', () => {
  it('finds phone, name, email under common aliases', () => {
    const l = extractLead({ Mobile: '98765 43210', 'Full Name': 'Asha Verma', Email: 'ASHA@Example.com', city: 'Lucknow' });
    expect(l).toMatchObject({ phone: '98765 43210', name: 'Asha Verma', email: 'asha@example.com' }); expect(l.fields).toEqual({ city: 'Lucknow' });
  });
  it('joins first and last name', () => { expect(extractLead({ first_name: 'Ravi', last_name: 'Kumar', phone: '9876543210' }).name).toBe('Ravi Kumar'); });
  it('drops an invalid email instead of failing the lead', () => { expect(extractLead({ phone: '9876543210', email: 'not-an-email' }).email).toBeNull(); });
  it('captures UTM and click ids and keeps them out of the extra fields', () => {
    const l = extractLead({ phone: '9876543210', utm_source: 'google', utm_campaign: 'diwali', fbclid: 'abc', page_url: 'https://x.in/lp' });
    expect(l.utm).toEqual({ utm_source: 'google', utm_campaign: 'diwali', fbclid: 'abc' }); expect(l.sourceUrl).toBe('https://x.in/lp'); expect(l.fields).toEqual({});
  });
  it('honours a per-source field map using the platform’s own names', () => {
    const l = extractLead({ 'Contact No': '9876543210', Customer: 'Meena', phone: 'decoy' }, { phone: 'Contact No', name: 'Customer' });
    expect(l.phone).toBe('9876543210'); expect(l.name).toBe('Meena');
  });
  it('splits comma tags and caps them', () => { expect(extractLead({ phone: '1', tags: 'vip, diwali ,,x' }).tags).toEqual(['vip', 'diwali', 'x']); });
  it('reports a missing phone rather than inventing one', () => {
    expect(phoneFromLead(extractLead({ name: 'No Phone' }))).toMatchObject({ ok: false });
    expect(phoneFromLead(extractLead({ phone: '98765 43210' }))).toEqual({ ok: true, e164: '+919876543210' });
    expect(phoneFromLead(extractLead({ phone: '12345' }))).toMatchObject({ ok: false });
  });
});

describe('consent: a lead is not marketing consent', () => {
  it('truthiness is strict: only clear yes values', () => {
    for (const v of [true, 1, 'true', 'Yes', 'on', 'I agree', 'checked', ' Y ']) expect(isTruthy(v)).toBe(true);
    for (const v of [false, 0, '', 'no', 'false', 'off', 'maybe', null, undefined, 'unchecked']) expect(isTruthy(v)).toBe(false);
  });
  it('mode none never grants consent, even if the payload says yes', () => {
    expect(decideConsent('none', extractLead({ phone: '1', whatsapp_consent: 'yes' }))).toMatchObject({ status: 'unknown' });
  });
  it('mode field grants only when this submission ticked the box', () => {
    expect(decideConsent('field', extractLead({ phone: '1', whatsapp_consent: 'yes' }))).toMatchObject({ status: 'allowed', source: 'Website form' });
    expect(decideConsent('field', extractLead({ phone: '1' }))).toMatchObject({ status: 'unknown', reason: 'consent_field_missing' });
    expect(decideConsent('field', extractLead({ phone: '1', whatsapp_consent: 'no' }))).toMatchObject({ status: 'unknown' });
  });
  it('mode attested grants for every submission', () => { expect(decideConsent('attested', extractLead({ phone: '1' }))).toMatchObject({ status: 'allowed', reason: 'source_attested' }); });
});

describe('makeLimiter', () => {
  it('allows `limit` per window per key, then refuses, then recovers', () => {
    let t = 0; const ok = makeLimiter(3, 1000, () => t);
    expect([ok('a'), ok('a'), ok('a'), ok('a')]).toEqual([true, true, true, false]);
    expect(ok('b')).toBe(true);
    t = 1001; expect(ok('a')).toBe(true);
  });
});
