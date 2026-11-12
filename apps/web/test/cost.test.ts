import { describe, expect, it } from 'vitest';
import { estimateCost, inr } from '../src/lib/cost';

describe('estimateCost', () => {
  it('matches the spec example: 1,240 x ₹0.8631 = ₹1,070.24 + GST ₹192.64', () => {
    const c = estimateCost(1240, 'marketing');
    expect(c.basePaise).toBe(107024);
    expect(c.gstPaise).toBe(19264);
    expect(c.totalPaise).toBe(126288);
    expect(c.totalLabel).toBe('₹1,262.88');
  });
  it('uses the utility rate for updates and OTP', () => {
    expect(estimateCost(1000, 'utility').basePaise).toBe(11500);
    expect(estimateCost(1000, 'authentication').basePaise).toBe(11500);
  });
  it('is zero for zero messages and falls back to marketing for unknown types', () => {
    expect(estimateCost(0, 'marketing').totalPaise).toBe(0);
    expect(estimateCost(100, 'weird').basePaise).toBe(estimateCost(100, 'marketing').basePaise);
  });
  it('formats rupees with Indian digit grouping', () => {
    expect(inr(10000000)).toBe('₹1,00,000.00');
  });
});
