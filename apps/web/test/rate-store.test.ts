import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

vi.mock('server-only', () => ({}));

/** The limiter against a real Redis, with two separate module copies standing in for two web processes. */
const URL_ = process.env.REDIS_URL ?? 'redis://localhost:6380';
let probe: Redis; const made: string[] = [];
beforeAll(() => { probe = new Redis(URL_, { maxRetriesPerRequest: 1 }); });
afterAll(async () => { for (const k of await probe.keys('rl:t-*')) await probe.del(k); for (const k of await probe.keys('ba:t-*')) await probe.del(k); await probe.quit(); });

async function freshProcess(url: string | undefined) {
  vi.resetModules(); delete (globalThis as { __lbcRateRedis?: unknown }).__lbcRateRedis;
  if (url === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = url;
  return import('../src/lib/rate-store');
}
const name = () => { const n = 't-' + randomUUID().slice(0, 8); made.push(n); return n; };

describe('rate limits shared through Redis', () => {
  it('two web processes count together: the limit holds across both', async () => {
    const n = name(); const p1 = await freshProcess(URL_); const l1 = p1.limiter(n, 5, 60_000);
    const p2 = await freshProcess(URL_); const l2 = p2.limiter(n, 5, 60_000);
    const results: number[] = [];
    for (let i = 0; i < 3; i++) results.push(await l1.check('203.0.113.9'));
    for (let i = 0; i < 4; i++) results.push(await l2.check('203.0.113.9'));
    expect(results.slice(0, 5).every((r) => r === 0)).toBe(true);             // first five allowed, 3 on one process and 2 on the other
    expect(results[5]).toBeGreaterThan(0); expect(results[6]).toBeGreaterThan(0);   // the sixth and seventh are refused, whichever process they hit
  });

  it('different addresses and different limiters do not share counts', async () => {
    const n = name(), m = name(); const p = await freshProcess(URL_); const a = p.limiter(n, 2, 60_000), b = p.limiter(m, 2, 60_000);
    await a.check('x'); await a.check('x'); expect(await a.check('x')).toBeGreaterThan(0);
    expect(await a.check('y')).toBe(0); expect(await b.check('x')).toBe(0);
  });

  it('peek does not count, and reports when the budget is already used', async () => {
    const n = name(); const p = await freshProcess(URL_); const l = p.limiter(n, 3, 60_000);
    for (let i = 0; i < 10; i++) expect(await l.peek('z')).toBe(0);            // looking never uses the budget
    await l.check('z'); await l.check('z'); await l.check('z');
    expect(await l.peek('z')).toBeGreaterThan(0);
  });

  it('the wait it reports is in seconds, at least 1, and no longer than the window', async () => {
    const n = name(); const p = await freshProcess(URL_); const l = p.limiter(n, 1, 30_000);
    await l.check('w'); const wait = await l.check('w'); expect(wait).toBeGreaterThanOrEqual(1); expect(wait).toBeLessThanOrEqual(30);
  });

  it('counts leave Redis on their own after the window', async () => {
    const n = name(); const p = await freshProcess(URL_); const l = p.limiter(n, 2, 1500);
    await l.check('e'); const ttl = await probe.pttl(`rl:${n}:e`); expect(ttl).toBeGreaterThan(0); expect(ttl).toBeLessThanOrEqual(2600);
  });

  it('after the window has passed the person can try again', async () => {
    const n = name(); const p = await freshProcess(URL_); const l = p.limiter(n, 1, 700);
    expect(await l.check('r')).toBe(0); expect(await l.check('r')).toBeGreaterThan(0);
    await new Promise((ok) => setTimeout(ok, 900)); expect(await l.check('r')).toBe(0);
  });

  it('with no Redis configured the limiter still works, counting in the process', async () => {
    const p = await freshProcess(undefined); const l = p.limiter(name(), 2, 60_000);
    expect(await l.check('m')).toBe(0); expect(await l.check('m')).toBe(0); expect(await l.check('m')).toBeGreaterThan(0);
  });

  it('when Redis is down the site keeps working: it falls back to counting in the process, and still limits', async () => {
    const errs = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const p = await freshProcess('redis://127.0.0.1:1');                      // nothing listens here
    const l = p.limiter(name(), 2, 60_000);
    expect(await l.check('d')).toBe(0); expect(await l.check('d')).toBe(0); expect(await l.check('d')).toBeGreaterThan(0);
    expect(await l.peek('d')).toBeGreaterThan(0); expect(errs).toHaveBeenCalled(); errs.mockRestore();
  });
});

describe('sign-in attempt storage for Better Auth', () => {
  it('counts attempts per key inside a window, refuses past the max with a retry time, and is shared between processes', async () => {
    const k = name(); const p1 = await freshProcess(URL_), p2 = await freshProcess(URL_);
    const rule = { window: 60, max: 3 }; const out = [];
    out.push(await p1.authRateStorage!.consume(k, rule)); out.push(await p2.authRateStorage!.consume(k, rule)); out.push(await p1.authRateStorage!.consume(k, rule));
    expect(out.every((o) => o.allowed && o.retryAfter === null)).toBe(true);
    const over = await p2.authRateStorage!.consume(k, rule); expect(over.allowed).toBe(false); expect(over.retryAfter).toBeGreaterThanOrEqual(1); expect(over.retryAfter).toBeLessThanOrEqual(60);
  });

  it('the window clears on its own; a different key is unaffected', async () => {
    const k = name(), k2 = name(); const p = await freshProcess(URL_); const rule = { window: 1, max: 1 };
    expect((await p.authRateStorage!.consume(k, rule)).allowed).toBe(true); expect((await p.authRateStorage!.consume(k, rule)).allowed).toBe(false);
    expect((await p.authRateStorage!.consume(k2, rule)).allowed).toBe(true);
    await new Promise((ok) => setTimeout(ok, 1300)); expect((await p.authRateStorage!.consume(k, rule)).allowed).toBe(true);
  });

  it('a counter that lost its expiry still gets one, so a person is never locked out for good', async () => {
    const k = name(); const p = await freshProcess(URL_); await probe.set(`ba:${k}`, '50');   // a count with no expiry, as if the expire call had been lost
    const r = await p.authRateStorage!.consume(k, { window: 60, max: 3 }); expect(r.allowed).toBe(false);
    const ttl = await probe.pttl(`ba:${k}`); expect(ttl).toBeGreaterThan(0); expect(ttl).toBeLessThanOrEqual(60_000);
  });

  it('when Redis is down sign-in is not blocked', async () => {
    const errs = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const p = await freshProcess('redis://127.0.0.1:1'); const r = await p.authRateStorage!.consume(name(), { window: 60, max: 1 });
    expect(r).toEqual({ allowed: true, retryAfter: null }); errs.mockRestore();
  });

  it('no storage is offered when Redis is not configured, so Better Auth keeps its own', async () => {
    const p = await freshProcess(undefined); expect(p.authRateStorage).toBeUndefined();
  });
});
