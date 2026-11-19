import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * API keys for agents (Claude, Hermes, scripts). A key is shown once; only its SHA-256 is stored, so a database leak does not leak working keys.
 * Keys are 256 bits of randomness, so a plain SHA-256 is enough (there is nothing to brute-force, unlike a human password).
 */
import { API_SCOPES, type ApiScope } from './api-scopes';
export { API_SCOPES, DEFAULT_SCOPES, SCOPE_INFO, type ApiScope } from './api-scopes';

const KEY_RE = /^lbc_[a-f0-9]{8}_[A-Za-z0-9_-]{43}$/;

export interface NewApiKey { key: string; prefix: string; hash: string }

export function generateApiKey(): NewApiKey {
  const id = randomBytes(4).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const key = `lbc_${id}_${secret}`;
  return { key, prefix: `lbc_${id}`, hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** True only for something shaped like a key we could have issued. Anything else is refused before it touches the database. */
export function looksLikeApiKey(s: unknown): s is string {
  return typeof s === 'string' && KEY_RE.test(s);
}

/** Pulls the key out of `Authorization: Bearer ...` or `x-api-key`. Returns null when absent or malformed. */
export function keyFromHeaders(get: (name: string) => string | null): string | null {
  const auth = get('authorization');
  const m = auth ? /^Bearer\s+(\S+)$/i.exec(auth.trim()) : null;
  const k = m?.[1] ?? get('x-api-key')?.trim() ?? null;
  return looksLikeApiKey(k) ? k : null;
}

export function hasScope(scopes: readonly string[], need: ApiScope): boolean {
  return scopes.includes(need);
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Every call a key makes is counted. A key that goes past `limit` calls inside `windowMs` is refused until the window moves on.
 * In memory per process (documented limitation: several web processes need a shared store).
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs: number, private readonly now: () => number = Date.now) {}
  /** Same answer as check() but does not count the call: 0 if there is room, otherwise the seconds to wait. */
  peek(id: string): number {
    const t = this.now();
    const fresh = (this.hits.get(id) ?? []).filter((x) => x > t - this.windowMs);
    return fresh.length >= this.limit ? Math.max(1, Math.ceil((fresh[0]! + this.windowMs - t) / 1000)) : 0;
  }
  /** Returns 0 when allowed (and counts the call), otherwise the seconds to wait. */
  check(id: string): number {
    const t = this.now();
    const fresh = (this.hits.get(id) ?? []).filter((x) => x > t - this.windowMs);
    if (fresh.length >= this.limit) { this.hits.set(id, fresh); return Math.max(1, Math.ceil((fresh[0]! + this.windowMs - t) / 1000)); }
    fresh.push(t); this.hits.set(id, fresh);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some((x) => x > t - this.windowMs)) this.hits.delete(k);
    return 0;
  }
}

/**
 * The most a key may spend in total in a day, across all sends it starts. Per-send cap is on the key; this stops
 * an agent from splitting one big send into many small ones to get around it.
 */
export const DAILY_SPEND_MULTIPLE = 3;
export function dailyLimitPaise(sendCapPaise: number): number {
  return sendCapPaise * DAILY_SPEND_MULTIPLE;
}

/**
 * Where a rate limiter keeps its counts. The memory store is private to one process; a shared store (Redis in production) is seen by every web process, so the
 * limit means the same thing however many processes run. A store may throw: the limiter then falls back to its own memory so a store outage never takes the site down.
 */
export interface RateStore {
  /** Count one hit for `id` inside a sliding window and return how many hits (including this one) are inside it, plus the ms until the oldest one leaves. */
  hit(id: string, windowMs: number, now: number): Promise<{ count: number; oldestAgeMs: number }>;
  /** Same, without counting. */
  look(id: string, windowMs: number, now: number): Promise<{ count: number; oldestAgeMs: number }>;
}

export class SharedRateLimiter {
  private readonly local: RateLimiter;
  constructor(private readonly store: RateStore | null, private readonly limit: number, private readonly windowMs: number, private readonly name: string, private readonly now: () => number = Date.now, private readonly onFallback: (e: unknown) => void = () => undefined) {
    this.local = new RateLimiter(limit, windowMs, now);
  }
  private wait(r: { count: number; oldestAgeMs: number }) { return r.count > this.limit ? Math.max(1, Math.ceil((this.windowMs - r.oldestAgeMs) / 1000)) : 0; }
  /** 0 when allowed (and counted), otherwise the seconds to wait. */
  async check(id: string): Promise<number> {
    if (!this.store) return this.local.check(id);
    try { return this.wait(await this.store.hit(`${this.name}:${id}`, this.windowMs, this.now())); } catch (e) { this.onFallback(e); return this.local.check(id); }
  }
  /** Like check but does not count. 0 if there is room. */
  async peek(id: string): Promise<number> {
    if (!this.store) return this.local.peek(id);
    try { const r = await this.store.look(`${this.name}:${id}`, this.windowMs, this.now()); return r.count >= this.limit ? Math.max(1, Math.ceil((this.windowMs - r.oldestAgeMs) / 1000)) : 0; } catch (e) { this.onFallback(e); return this.local.peek(id); }
  }
}
