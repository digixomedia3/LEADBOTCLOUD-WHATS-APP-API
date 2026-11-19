import type { Redis } from 'ioredis';
import type { FairShareStore } from '@lbc/shared/fair-share';

/**
 * The counters live in Redis so that several worker processes share one picture of who is sending. Each second gets one hash (workspace id to count) that
 * disappears by itself after 10 seconds, so nothing needs cleaning up and nothing grows.
 */
export class RedisFairShareStore implements FairShareStore {
  constructor(private readonly redis: Redis, private readonly prefix = 'fairshare') {}
  private key(second: number) { return `${this.prefix}:${second}`; }
  async bump(tenantId: string, second: number): Promise<number> {
    const k = this.key(second);
    const [[, n]] = (await this.redis.multi().hincrby(k, tenantId, 1).expire(k, 10).exec()) as [[unknown, number], unknown];
    return Number(n);
  }
  async othersActive(tenantId: string, second: number): Promise<number> {
    const keys = await this.redis.hkeys(this.key(second));
    return keys.filter((t) => t !== tenantId).length;
  }
}
