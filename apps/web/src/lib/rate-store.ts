import 'server-only';
import Redis from 'ioredis';
import { SharedRateLimiter, type RateStore } from '@lbc/shared/api-keys';

/**
 * Rate-limit counts shared by every web process through Redis (a sorted set per key: one entry per hit, scored by time). If REDIS_URL is not set, or Redis
 * cannot be reached, the limiters fall back to counting in this process alone, which is what the app did before. A Redis outage therefore weakens the limits a
 * little but never refuses real visitors.
 */
declare global { var __lbcRateRedis: Redis | null | undefined; var __lbcRateWarned: number | undefined }
function client(): Redis | null {
  if (globalThis.__lbcRateRedis !== undefined) return globalThis.__lbcRateRedis;
  const url = process.env.REDIS_URL;
  if (!url) return (globalThis.__lbcRateRedis = null);
  const r = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: true, connectTimeout: 1500, commandTimeout: 800, retryStrategy: (n) => Math.min(n * 200, 2000), lazyConnect: false });
  r.on('error', () => undefined);     // reported per call by the limiter; an unhandled 'error' event must not crash the process
  return (globalThis.__lbcRateRedis = r);
}

export const redisRateStore: RateStore | null = process.env.REDIS_URL ? {
  async hit(id, windowMs, now) {
    const r = client(); if (!r) throw new Error('no redis');
    const k = `rl:${id}`; const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;
    const res = await r.multi().zremrangebyscore(k, 0, now - windowMs).zadd(k, now, member).zcard(k).zrange(k, 0, 0, 'WITHSCORES').pexpire(k, windowMs + 1000).exec();
    if (!res) throw new Error('redis transaction failed');
    const count = Number(res[2]![1]); const oldest = Number((res[3]![1] as string[])[1] ?? now);
    return { count, oldestAgeMs: now - oldest };
  },
  async look(id, windowMs, now) {
    const r = client(); if (!r) throw new Error('no redis');
    const k = `rl:${id}`;
    const res = await r.multi().zremrangebyscore(k, 0, now - windowMs).zcard(k).zrange(k, 0, 0, 'WITHSCORES').exec();
    if (!res) throw new Error('redis transaction failed');
    return { count: Number(res[1]![1]), oldestAgeMs: now - Number((res[2]![1] as string[])[1] ?? now) };
  },
} : null;

const warn = (e: unknown) => { const t = Date.now(); if (!globalThis.__lbcRateWarned || t - globalThis.__lbcRateWarned > 60_000) { globalThis.__lbcRateWarned = t; console.error('[rate-limit] Redis unavailable, counting in this process only:', (e as Error).message); } };
export const limiter = (name: string, limit: number, windowMs: number) => new SharedRateLimiter(redisRateStore, limit, windowMs, name, Date.now, warn);

/**
 * Sign-in, sign-up and two-step attempts are limited by Better Auth, which counts in this process's memory unless it is given somewhere shared. This gives it Redis:
 * one counter per key and window, created with the window as its life, so it clears itself. If Redis is unreachable the attempt is allowed and the error is
 * logged: refusing every sign-in because a cache is down would be worse than a short gap in the limit (the password check and the account lockout still apply).
 */
export const authRateStorage = process.env.REDIS_URL ? {
  async consume(key: string, rule: { window: number; max: number }): Promise<{ allowed: boolean; retryAfter: number | null }> {
    try {
      const r = client(); if (!r) throw new Error('no redis');
      const k = `ba:${key}`;
      const res = await r.multi().incr(k).pttl(k).exec();
      if (!res) throw new Error('redis transaction failed');
      const count = Number(res[0]![1]); let ttl = Number(res[1]![1]);
      if (ttl < 0) { await r.pexpire(k, rule.window * 1000); ttl = rule.window * 1000; }   // first hit (or a key that lost its expiry): start the window
      return count <= rule.max ? { allowed: true, retryAfter: null } : { allowed: false, retryAfter: Math.max(1, Math.ceil(ttl / 1000)) };
    } catch (e) { warn(e); return { allowed: true, retryAfter: null }; }
  },
} : undefined;
