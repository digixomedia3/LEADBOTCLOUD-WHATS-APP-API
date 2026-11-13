import { describe, expect, it } from 'vitest';
import { GST_RATE_PCT, PLAN_PRICE_PAISE, financialYear, invoiceNumber, isPaidPlan, overLimits, planCharge, planRank, priceWithGst, splitInclusive } from '../src/billing';

describe('GST maths (integer paise)', () => {
  it('adds 18% GST to every paid plan and the parts always add up', () => {
    expect(GST_RATE_PCT).toBe(18);
    expect(planCharge('starter')).toEqual({ basePaise: 49_900, gstPaise: 8_982, totalPaise: 58_882 });
    expect(planCharge('growth')).toEqual({ basePaise: 129_900, gstPaise: 23_382, totalPaise: 153_282 });
    expect(planCharge('pro')).toEqual({ basePaise: 299_900, gstPaise: 53_982, totalPaise: 353_882 });
    for (const p of Object.keys(PLAN_PRICE_PAISE) as ('starter' | 'growth' | 'pro')[]) { const c = planCharge(p); expect(c.basePaise + c.gstPaise).toBe(c.totalPaise); }
  });
  it('rounds the tax, never the base, and handles odd amounts', () => {
    expect(priceWithGst(1)).toEqual({ basePaise: 1, gstPaise: 0, totalPaise: 1 });
    expect(priceWithGst(3)).toEqual({ basePaise: 3, gstPaise: 1, totalPaise: 4 });
    expect(priceWithGst(0)).toEqual({ basePaise: 0, gstPaise: 0, totalPaise: 0 });
  });
  it('splitting what was charged gives back the same base and tax', () => {
    for (const base of [49_900, 129_900, 299_900, 12_345, 99_999]) {
      const c = priceWithGst(base);
      const s = splitInclusive(c.totalPaise);
      expect(s.totalPaise).toBe(c.totalPaise); expect(s.basePaise + s.gstPaise).toBe(s.totalPaise);
      expect(Math.abs(s.basePaise - base)).toBeLessThanOrEqual(1);
    }
  });
});

describe('plans', () => {
  it('knows which plans are paid, and their order', () => {
    expect(['free', 'starter', 'growth', 'pro', 'gold', ''].map(isPaidPlan)).toEqual([false, true, true, true, false, false]);
    expect(planRank('free')).toBeLessThan(planRank('starter')); expect(planRank('growth')).toBeLessThan(planRank('pro')); expect(planRank('nope')).toBe(-1);
  });
  it('flags a workspace that is over its limits without deleting anything', () => {
    expect(overLimits('free', { contacts: 800, users: 1 }, { contacts: 500, users: 1 })).toEqual({ contacts: true, users: false, any: true });
    expect(overLimits('free', { contacts: 500, users: 1 }, { contacts: 500, users: 1 }).any).toBe(false);
  });
});

describe('invoice numbers and the Indian financial year', () => {
  it('April starts a new year and March ends it', () => {
    expect(financialYear(new Date('2026-11-13T10:00:00Z'))).toBe('2026-27');
    expect(financialYear(new Date('2027-03-31T10:00:00Z'))).toBe('2026-27');
    expect(financialYear(new Date('2027-04-01T10:00:00Z'))).toBe('2027-28');
  });
  it('uses India time at the boundary: 31 March 20:00 UTC is already 1 April in India', () => {
    expect(financialYear(new Date('2027-03-31T20:00:00Z'))).toBe('2027-28');
    expect(financialYear(new Date('2027-03-31T18:00:00Z'))).toBe('2026-27');
  });
  it('wraps the century correctly', () => { expect(financialYear(new Date('2099-06-01T00:00:00Z'))).toBe('2099-00'); });
  it('formats a padded, unique-looking number', () => {
    expect(invoiceNumber('2026-27', 1)).toBe('LBC/2026-27/000001'); expect(invoiceNumber('2026-27', 123456)).toBe('LBC/2026-27/123456');
  });
});
