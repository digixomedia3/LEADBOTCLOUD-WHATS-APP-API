import { describe, expect, it } from 'vitest';
import { DEFAULT_FAIR_SHARE, MemoryFairShareStore, decide, laneFor, type FairShareConfig } from '../src/fair-share';

const cfg: FairShareConfig = { budgetPerSecond: 10, sharePerSecond: 4, retryAfterMs: 1000 };
const T0 = 1_700_000_000_000;

describe('lanes', () => {
  it('a message a person typed is chat; anything started by a campaign or a journey is bulk', () => {
    expect(laneFor({})).toBe('chat');
    expect(laneFor({ sender_user_id: 'u1' })).toBe('chat');
    expect(laneFor({ campaign_recipient_id: 'r1' })).toBe('bulk');
    expect(laneFor({ journey_run_id: 'j1' })).toBe('bulk');
    expect(laneFor({ campaign_recipient_id: null, journey_run_id: null })).toBe('chat');
  });
});

describe('fair share of the send line', () => {
  it('a workspace sending alone may use the whole budget in a second, and the next message waits', async () => {
    const s = new MemoryFairShareStore(); const out: boolean[] = [];
    for (let i = 0; i < 12; i++) out.push((await decide(s, 'A', 'bulk', T0, cfg)).allow);
    expect(out.filter(Boolean).length).toBe(10); expect(out.slice(10)).toEqual([false, false]);
  });

  it('when a second workspace is also sending, the busy one is held to its share and the other still gets through', async () => {
    const s = new MemoryFairShareStore();
    expect((await decide(s, 'B', 'bulk', T0, cfg)).allow).toBe(true);                         // B is now active this second
    const a: boolean[] = []; for (let i = 0; i < 10; i++) a.push((await decide(s, 'A', 'bulk', T0, cfg)).allow);
    expect(a.filter(Boolean).length).toBe(4);                                                  // A got its share of 4, not 10
    expect((await decide(s, 'B', 'bulk', T0, cfg)).allow).toBe(true);                          // B is not blocked by A's flood
    expect((await decide(s, 'B', 'bulk', T0, cfg)).allow).toBe(true);
  });

  it('a held message says when to come back, and is not counted against the share it is waiting for', async () => {
    const s = new MemoryFairShareStore(); await decide(s, 'B', 'bulk', T0, cfg);
    for (let i = 0; i < 4; i++) await decide(s, 'A', 'bulk', T0, cfg);
    const held = await decide(s, 'A', 'bulk', T0, cfg); expect(held).toEqual({ allow: false, retryAfterMs: 1000, reason: 'share_used' });
    // One second later A has a fresh share, and B still being active keeps the limit at 4, so exactly 4 go through again.
    await decide(s, 'B', 'bulk', T0 + 1000, cfg);
    const next: boolean[] = []; for (let i = 0; i < 6; i++) next.push((await decide(s, 'A', 'bulk', T0 + 1000, cfg)).allow);
    expect(next.filter(Boolean).length).toBe(4);
  });

  it('once the other workspace stops, the busy one gets the whole line back within two seconds', async () => {
    const s = new MemoryFairShareStore(); await decide(s, 'B', 'bulk', T0, cfg);
    expect((await decide(s, 'A', 'bulk', T0 + 1000, cfg)).allow).toBe(true);                   // B sent in the previous second, so the share still applies
    const later: boolean[] = []; for (let i = 0; i < 12; i++) later.push((await decide(s, 'A', 'bulk', T0 + 3000, cfg)).allow);
    expect(later.filter(Boolean).length).toBe(10);                                              // nobody else for two seconds: full budget
  });

  it('a workspace that sent in the previous second still counts as active, so a burst cannot dodge the share by straddling a second boundary', async () => {
    const s = new MemoryFairShareStore();
    await decide(s, 'B', 'bulk', T0, cfg);                                                       // B sent in second 0 and nothing yet in second 1
    const a: boolean[] = []; for (let i = 0; i < 8; i++) a.push((await decide(s, 'A', 'bulk', T0 + 1000, cfg)).allow);
    expect(a.filter(Boolean).length).toBe(4);                                                    // B is recent, so A is held to its share of 4 (not 8 or 10)
  });

  it('chat messages are never held, however busy the line is', async () => {
    const s = new MemoryFairShareStore(); await decide(s, 'B', 'bulk', T0, cfg);
    for (let i = 0; i < 50; i++) await decide(s, 'A', 'bulk', T0, cfg);
    for (let i = 0; i < 20; i++) expect(await decide(s, 'A', 'chat', T0, cfg)).toEqual({ allow: true, retryAfterMs: 0 });
  });

  it('chat messages do not use up the bulk share', async () => {
    const s = new MemoryFairShareStore(); await decide(s, 'B', 'bulk', T0, cfg);
    for (let i = 0; i < 30; i++) await decide(s, 'A', 'chat', T0, cfg);
    const a: boolean[] = []; for (let i = 0; i < 6; i++) a.push((await decide(s, 'A', 'bulk', T0, cfg)).allow);
    expect(a.filter(Boolean).length).toBe(4);
  });

  it('three busy workspaces each get their share and none starves another', async () => {
    const s = new MemoryFairShareStore(); const got: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (let round = 0; round < 8; round++) for (const t of ['A', 'B', 'C']) if ((await decide(s, t, 'bulk', T0, cfg)).allow) got[t]!++;
    expect(got.A).toBeGreaterThan(0); expect(got.B).toBeGreaterThan(0); expect(got.C).toBeGreaterThan(0);
    expect(Math.max(...Object.values(got)) - Math.min(...Object.values(got))).toBeLessThanOrEqual(1);
    expect(Math.max(...Object.values(got))).toBeLessThanOrEqual(cfg.sharePerSecond);
  });

  it('a share larger than the budget cannot exceed the budget', async () => {
    const s = new MemoryFairShareStore(); const big: FairShareConfig = { budgetPerSecond: 5, sharePerSecond: 50, retryAfterMs: 500 };
    await decide(s, 'B', 'bulk', T0, big); const a: boolean[] = []; for (let i = 0; i < 9; i++) a.push((await decide(s, 'A', 'bulk', T0, big)).allow);
    expect(a.filter(Boolean).length).toBe(5);
  });

  it('the defaults leave room: one workspace cannot take more than a quarter of the line while others send', () => {
    expect(DEFAULT_FAIR_SHARE.sharePerSecond / DEFAULT_FAIR_SHARE.budgetPerSecond).toBeLessThanOrEqual(0.25);
    expect(DEFAULT_FAIR_SHARE.retryAfterMs).toBeGreaterThanOrEqual(500);
  });
});
