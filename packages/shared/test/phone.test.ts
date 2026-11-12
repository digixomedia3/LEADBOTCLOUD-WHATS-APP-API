import { describe, expect, it } from 'vitest';
import { formatPhone, maskPhone, normalizePhone } from '../src/phone';
import { categoryRisk, planLimits } from '../src/plans';

const ok = (s: string, e: string) => expect(normalizePhone(s)).toEqual({ ok: true, e164: e });
const bad = (s: unknown) => expect(normalizePhone(s).ok).toBe(false);

describe('normalizePhone', () => {
  it('handles the usual Indian formats', () => {
    ok('9876543210', '+919876543210');
    ok('98765 43210', '+919876543210');
    ok('98765-43210', '+919876543210');
    ok('09876543210', '+919876543210');
    ok('919876543210', '+919876543210');
    ok('+91 98765 43210', '+919876543210');
    ok('0091 98765 43210', '+919876543210');
    ok('(+91) 98765-43210', '+919876543210');
    ok('9876543210.0', '+919876543210');
    ok(' 9876543210 ', '+919876543210');
  });
  it('accepts other countries only with + or 00', () => {
    ok('+1 415 555 2671', '+14155552671');
    ok('00447911123456', '+447911123456');
    bad('4155552671');
  });
  it('rejects bad Indian numbers with a reason', () => {
    bad('12345'); bad('5876543210'); bad('987654321'); bad('98765432101'); bad('+91 12345 67890'); bad(''); bad(null); bad(undefined);
    const r = normalizePhone('abc');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(10);
  });
  it('explains Excel scientific notation', () => {
    const r = normalizePhone('9.87654E+09');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Excel/);
  });
  it('formats and masks', () => {
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210');
    expect(maskPhone('+919876543210')).toBe('+91•••••3210');
  });
});

describe('plans and categories', () => {
  it('falls back to free for unknown plans', () => {
    expect(planLimits('nope').contacts).toBe(500);
    expect(planLimits('growth').contacts).toBe(25000);
  });
  it('screens risky and prohibited categories', () => {
    expect(categoryRisk('retail')).toBe('ok');
    expect(categoryRisk('finance')).toBe('review');
    expect(categoryRisk('gambling')).toBe('blocked');
    expect(categoryRisk('made-up')).toBeNull();
  });
});
