import { describe, expect, it } from 'vitest';
import { API_SCOPES, DEFAULT_SCOPES, RateLimiter, dailyLimitPaise, generateApiKey, hasScope, hashApiKey, keyFromHeaders, looksLikeApiKey, safeEqual } from '../src/api-keys';

describe('api keys', () => {
  it('a new key has the documented shape, a matching prefix and a hash that is not the key', () => {
    const k = generateApiKey();
    expect(looksLikeApiKey(k.key)).toBe(true);
    expect(k.key.startsWith(k.prefix + '_')).toBe(true);
    expect(k.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(k.hash).not.toContain(k.key);
    expect(hashApiKey(k.key)).toBe(k.hash);
  });
  it('two keys are never the same (and carry real randomness)', () => {
    const keys = new Set(Array.from({ length: 500 }, () => generateApiKey().key));
    expect(keys.size).toBe(500);
  });
  it('the hash changes if even one character of the key changes', () => {
    const k = generateApiKey().key; const flipped = k.slice(0, -1) + (k.endsWith('A') ? 'B' : 'A');
    expect(hashApiKey(flipped)).not.toBe(hashApiKey(k));
  });
  it('only things shaped like our keys are accepted', () => {
    const good = generateApiKey().key;
    for (const bad of ['', 'lbc_', 'lbc_12345678_short', good + 'x', good.slice(1), good.toUpperCase(), ' ' + good, 'sk-' + good, null, undefined, 42, `${good}\n`, good.replace('lbc_', 'LBC_')])
      expect(looksLikeApiKey(bad as never), String(bad)).toBe(false);
    expect(looksLikeApiKey(good)).toBe(true);
  });
  it('reads the key from a Bearer header or x-api-key, and nothing else', () => {
    const k = generateApiKey().key; const h = (m: Record<string, string>) => (n: string) => m[n] ?? null;
    expect(keyFromHeaders(h({ authorization: `Bearer ${k}` }))).toBe(k);
    expect(keyFromHeaders(h({ authorization: `bearer ${k}` }))).toBe(k);
    expect(keyFromHeaders(h({ 'x-api-key': k }))).toBe(k);
    expect(keyFromHeaders(h({ authorization: k }))).toBeNull();
    expect(keyFromHeaders(h({ authorization: `Basic ${k}` }))).toBeNull();
    expect(keyFromHeaders(h({ authorization: `Bearer ${k} extra` }))).toBeNull();
    expect(keyFromHeaders(h({ authorization: 'Bearer nope' }))).toBeNull();
    expect(keyFromHeaders(h({}))).toBeNull();
  });
  it('a new key cannot message anyone or spend money unless that is chosen on purpose', () => {
    expect(DEFAULT_SCOPES).not.toContain('campaigns:send');
    expect(hasScope(DEFAULT_SCOPES, 'campaigns:send')).toBe(false);
    for (const s of DEFAULT_SCOPES) expect(API_SCOPES).toContain(s);
  });
  it('hasScope is exact: a read permission does not grant its write twin', () => {
    expect(hasScope(['contacts:read'], 'contacts:write')).toBe(false);
    expect(hasScope(['campaigns:write'], 'campaigns:send')).toBe(false);
    expect(hasScope(['campaigns:send'], 'campaigns:send')).toBe(true);
  });
  it('safeEqual compares without caring about length tricks', () => {
    expect(safeEqual('abc', 'abc')).toBe(true); expect(safeEqual('abc', 'abd')).toBe(false); expect(safeEqual('abc', 'abcd')).toBe(false); expect(safeEqual('', '')).toBe(true);
  });
  it('the daily spend limit is three times the per-send limit', () => { expect(dailyLimitPaise(50000)).toBe(150000); expect(dailyLimitPaise(0)).toBe(0); });
});

describe('rate limiter', () => {
  it('lets the first N through, refuses the next, and recovers when the window moves on', () => {
    let t = 1_000_000; const rl = new RateLimiter(3, 60_000, () => t);
    expect([rl.check('a'), rl.check('a'), rl.check('a')]).toEqual([0, 0, 0]);
    expect(rl.check('a')).toBeGreaterThan(0);
    t += 59_000; expect(rl.check('a')).toBeGreaterThan(0);
    t += 2_000; expect(rl.check('a')).toBe(0);
  });
  it('keeps every key separate', () => {
    const rl = new RateLimiter(1, 60_000, () => 5); expect(rl.check('a')).toBe(0); expect(rl.check('b')).toBe(0); expect(rl.check('a')).toBeGreaterThan(0);
  });
  it('peek never uses up a call', () => {
    const rl = new RateLimiter(1, 60_000, () => 5);
    for (let i = 0; i < 10; i++) expect(rl.peek('a')).toBe(0);
    expect(rl.check('a')).toBe(0); expect(rl.peek('a')).toBeGreaterThan(0);
  });
  it('a refused call does not extend the lockout', () => {
    let t = 0; const rl = new RateLimiter(1, 10_000, () => t);
    rl.check('a'); t = 5000; for (let i = 0; i < 50; i++) rl.check('a');
    t = 10_001; expect(rl.check('a')).toBe(0);
  });
});
