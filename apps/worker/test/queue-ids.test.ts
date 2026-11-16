import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { deferredJobId, dueJobId, retryJobId } from '../src/queue-ids';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6380', { maxRetriesPerRequest: null });
const q = new Queue(`send-test-${randomUUID().slice(0, 8)}`, { connection: redis });
afterAll(async () => { await q.obliterate({ force: true }); await q.close(); redis.disconnect(); });

// These go through the REAL queue library, because the earlier bug (a ":" in the id) only shows up there.
describe('send queue job ids are accepted by the real queue', () => {
  const id = randomUUID();
  it('plain, retry, deferred and due ids can all be added', async () => {
    for (const jobId of [id, retryJobId(id, 2), deferredJobId(id, Date.now() + 3_600_000), dueJobId(id, Date.now())])
      await expect(q.add('send', { messageId: id }, { jobId, delay: 60_000 }), jobId).resolves.toBeTruthy();
  });
  it('a colon is refused by the library (so the guard below matters)', async () => { await expect(q.add('send', {}, { jobId: `${id}:x` })).rejects.toThrow(/cannot contain/i); });
  it('no id helper ever produces a colon', () => { for (const x of [retryJobId(id, 1), deferredJobId(id, 1), dueJobId(id, 1)]) expect(x).not.toContain(':'); });
  it('the same message and time give the same id (no duplicates), different times give different ones', () => {
    expect(deferredJobId(id, 5)).toBe(deferredJobId(id, 5)); expect(deferredJobId(id, 5)).not.toBe(deferredJobId(id, 6));
    expect(dueJobId(id, 120_000)).toBe(dueJobId(id, 150_000)); expect(dueJobId(id, 120_000)).not.toBe(dueJobId(id, 180_000));
  });
});
