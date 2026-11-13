import { describe, expect, it } from 'vitest';
import { signInternal, verifyInternal } from '../src/internal-sign';
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

describe('platform formats', () => {
  const indiamart = { CODE: 200, STATUS: 'SUCCESS', RESPONSE: { UNIQUE_QUERY_ID: '621654886', QUERY_TYPE: 'B', QUERY_TIME: '2024-04-10 11:17:14', SENDER_NAME: 'Prabhat', SENDER_MOBILE: '+91-9999999999', SENDER_EMAIL: 'abcdeprabhat@gmail.com', SENDER_COMPANY: 'ABC Pvt Ltd.', SENDER_CITY: 'Noida', SENDER_COUNTRY_ISO: 'IN', SENDER_MOBILE_ALT: '+91-8888888888', QUERY_PRODUCT_NAME: 'Mineral Water Bottle', QUERY_MESSAGE: 'Need 100000 pieces' } };
  it('reads an IndiaMART push: unwraps RESPONSE, takes the query id, keeps product and message', () => {
    const l = extractLead(indiamart);
    expect(l).toMatchObject({ phone: '+91-9999999999', name: 'Prabhat', email: 'abcdeprabhat@gmail.com', externalId: '621654886' });
    expect(l.fields).toMatchObject({ query_product_name: 'Mineral Water Bottle', query_message: 'Need 100000 pieces', sender_city: 'Noida', sender_company: 'ABC Pvt Ltd.' });
    expect(l.fields).not.toHaveProperty('code'); expect(l.fields).not.toHaveProperty('status');
    expect(phoneFromLead(l)).toEqual({ ok: true, e164: '+919999999999' });
  });
  it('does not treat IndiaMART’s placeholder buyer name as a name', () => { expect(extractLead({ SENDER_NAME: 'IndiaMART Buyer', SENDER_MOBILE: '9999999999' }).name).toBeNull(); });
  it('falls back to the alternate mobile when the main one is a landline or invalid', () => {
    const l = extractLead({ SENDER_MOBILE: '0120-2222222', SENDER_MOBILE_ALT: '+91-8888888888' });
    expect(phoneFromLead(l)).toEqual({ ok: true, e164: '+918888888888' });
    expect(phoneFromLead(extractLead({ SENDER_MOBILE: '12345', SENDER_MOBILE_ALT: '678' }))).toMatchObject({ ok: false });
  });
  it('reads JustDial style query parameters (leadid, name, mobile, category, area, city)', () => {
    const l = extractLead({ leadid: 'JD99', leadtype: 'Phone', prefix: 'Mr', name: 'Asha', mobile: '9876543210', category: 'Sofa Dealers', area: 'Kothrud', city: 'Pune', date: '2026-11-13', time: '10:15' });
    expect(l).toMatchObject({ name: 'Asha', externalId: 'JD99' }); expect(l.fields).toMatchObject({ category: 'Sofa Dealers', area: 'Kothrud', city: 'Pune' });
  });
  it('a plain { RESPONSE } without CODE/STATUS is not mistaken for an envelope', () => {
    expect(extractLead({ response: 'yes please', phone: '9876543210' }).fields).toMatchObject({ response: 'yes please' });
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

describe('internal request signing', () => {
  const secret = 'internal-secret-0123456789';
  it('accepts a fresh, correctly signed body', () => { const { ts, sig } = signInternal(secret, '{"a":1}', 1_000_000_000_000); expect(verifyInternal(secret, '{"a":1}', ts, sig, 1_000_000_000_000 + 5_000)).toBe(true); });
  it('rejects an edited body, a wrong secret, and a missing or malformed header', () => {
    const { ts, sig } = signInternal(secret, '{"a":1}', 1_000_000_000_000), now = 1_000_000_000_000;
    expect(verifyInternal(secret, '{"a":2}', ts, sig, now)).toBe(false); expect(verifyInternal(secret + 'x', '{"a":1}', ts, sig, now)).toBe(false);
    for (const [t, s] of [[undefined, sig], [ts, undefined], ['abc', sig], [ts, 'zz'], [ts, sig + '00']] as const) expect(verifyInternal(secret, '{"a":1}', t, s, now)).toBe(false);
  });
  it('rejects a replay after 60 seconds and a timestamp from the future', () => {
    const { ts, sig } = signInternal(secret, 'x', 1_000_000_000_000);
    expect(verifyInternal(secret, 'x', ts, sig, 1_000_000_000_000 + 61_000)).toBe(false); expect(verifyInternal(secret, 'x', ts, sig, 1_000_000_000_000 - 61_000)).toBe(false);
  });
  it('refuses to run with no secret or a short one', () => { const { ts, sig } = signInternal('short', 'x'); expect(verifyInternal('', 'x', ts, sig)).toBe(false); expect(verifyInternal('short', 'x', ts, sig)).toBe(false); });
});
