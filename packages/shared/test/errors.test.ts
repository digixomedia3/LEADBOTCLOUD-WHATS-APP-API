import { describe, expect, it } from 'vitest';
import { backoffMs, errorPolicy } from '../src/errors';

describe('errorPolicy (spec section 6)', () => {
  it('maps the top-10 codes with English and Hinglish', () => {
    for (const c of [190, 368, 131048, 131026, 131042, 131047, 131049, 131050, 132001, 132015]) {
      const p = errorPolicy(c);
      expect(p.known).toBe(true);
      expect(p.en).toBeTruthy();
      expect(p.hi).toBeTruthy();
    }
  });
  it('token errors pause and ask to reconnect; 0 and 190 are the same', () => {
    expect(errorPolicy(190).action).toBe('reconnect');
    expect(errorPolicy(0).action).toBe('reconnect');
    expect(errorPolicy(190).retry).toBe('no');
  });
  it('131049 holds the contact 24 hours and is retried after a delay, never immediately', () => {
    const p = errorPolicy(131049);
    expect(p.action).toBe('hold_contact_24h');
    expect(p.retry).toBe('retry_delay');
  });
  it('131050 is never auto-retried for that user', () => {
    expect(errorPolicy(131050).retry).toBe('no_user');
    expect(errorPolicy(131050).action).toBe('opt_out_contact');
  });
  it('reroute codes are hidden from the owner (no message)', () => {
    expect(errorPolicy(131063).action).toBe('reroute_mm');
    expect(errorPolicy(131063).en).toBeNull();
    expect(errorPolicy(131055).action).toBe('reroute_messages');
    expect(errorPolicy(134100).action).toBe('reroute_messages');
  });
  it('200-299 are permission errors', () => {
    expect(errorPolicy(250).action).toBe('reconnect');
    expect(errorPolicy(299).known).toBe(true);
  });
  it('unknown codes are not guessed: they go to the dead-letter queue', () => {
    const p = errorPolicy(999999);
    expect(p.known).toBe(false);
    expect(p.action).toBe('dlq');
    expect(errorPolicy(undefined).known).toBe(false);
    expect(errorPolicy('abc').known).toBe(false);
  });
  it('accepts numeric strings', () => { expect(errorPolicy('131047').action).toBe('suggest_template'); });
});

describe('backoffMs (spec 4.5)', () => {
  it('throughput: 1 s x 2^attempt, capped at 60 s', () => {
    expect(backoffMs(errorPolicy(130429), 0)).toBe(1000);
    expect(backoffMs(errorPolicy(130429), 3)).toBe(8000);
    expect(backoffMs(errorPolicy(130429), 10)).toBe(60_000);
  });
  it('pair rate limit: 4^attempt seconds, then fail after the fifth', () => {
    expect([0, 1, 2, 3, 4].map((a) => backoffMs(errorPolicy(131056), a))).toEqual([1000, 4000, 16000, 64000, 256000]);
    expect(backoffMs(errorPolicy(131056), 5)).toBeNull();
  });
  it('maintenance: 30 s, 60 s, 120 s', () => {
    expect([0, 1, 2, 3].map((a) => backoffMs(errorPolicy(131057), a))).toEqual([30000, 60000, 120000, 120000]);
  });
  it('transient: 5 s x 3^attempt, max 5 attempts', () => {
    expect(backoffMs(errorPolicy(131000), 0)).toBe(5000);
    expect(backoffMs(errorPolicy(131000), 2)).toBe(45000);
    expect(backoffMs(errorPolicy(131000), 5)).toBeNull();
  });
  it('MM ad sync: 10 minutes, max 3 times', () => {
    expect(backoffMs(errorPolicy(134101), 0)).toBe(600_000);
    expect(backoffMs(errorPolicy(134101), 3)).toBeNull();
  });
  it('non-retryable policies never get a delay', () => {
    expect(backoffMs(errorPolicy(131047), 0)).toBeNull();
    expect(backoffMs(errorPolicy(190), 0)).toBeNull();
  });
});
