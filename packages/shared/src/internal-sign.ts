import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Web app -> worker calls (for things the web role is not allowed to do itself, such as creating leads).
 * The signature covers the timestamp and the exact body, so a captured request cannot be replayed later or edited.
 */
export const INTERNAL_MAX_AGE_MS = 60_000;

export function signInternal(secret: string, body: string, now = Date.now()): { ts: string; sig: string } {
  const ts = String(now);
  return { ts, sig: createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex') };
}

export function verifyInternal(secret: string | undefined, body: string, ts: string | undefined, sig: string | undefined, now = Date.now()): boolean {
  if (!secret || secret.length < 16 || !ts || !sig || !/^\d{10,15}$/.test(ts)) return false;
  if (Math.abs(now - Number(ts)) > INTERNAL_MAX_AGE_MS) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex'));
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got);
}
