/**
 * Fair sharing of the send line between workspaces.
 *
 * The worker sends at most BUDGET messages a second in total (Meta's own per-number ceiling is far higher; this is our safety limit). Without a rule, one workspace
 * that queues 50,000 campaign messages fills the line and a different workspace's customer reply waits behind all of them. The rule:
 *
 *  - Chat messages a person is waiting on (replies, notes sent from the inbox) are never held back by the share. They are rare and small, and a delay is visible to a human.
 *  - Bulk campaign and journey messages share the line. In any one second a workspace may use at most `share` of the budget. When it has used that, its next message is
 *    told to try again a moment later instead of being sent, so the line stays open for others. A lone busy workspace is not slowed unless others are active too,
 *    because the share only applies while another workspace sent bulk messages in the last few seconds.
 *
 * Pure functions here; the counting store (in memory for tests, Redis in production so several worker processes agree) is injected.
 */
export interface FairShareConfig {
  /** Total bulk messages per second across all workspaces. */
  budgetPerSecond: number;
  /** The most one workspace may use per second while at least one other workspace is also sending. */
  sharePerSecond: number;
  /** How far ahead a held message is pushed, in milliseconds. */
  retryAfterMs: number;
}

export const DEFAULT_FAIR_SHARE: FairShareConfig = { budgetPerSecond: 80, sharePerSecond: 20, retryAfterMs: 1000 };

export interface FairShareStore {
  /** Add one to this workspace's count for the given second and return the new count. */
  bump(tenantId: string, second: number): Promise<number>;
  /** How many OTHER workspaces sent bulk messages during the given second. */
  othersActive(tenantId: string, second: number): Promise<number>;
}

export type Lane = 'chat' | 'bulk';
export interface FairShareDecision { allow: boolean; retryAfterMs: number; reason?: 'share_used' }

/** Which lane a message belongs to. A reply or note typed by a person is chat; anything started by a campaign, a journey or a test send is bulk. */
export function laneFor(m: { campaign_recipient_id?: unknown; journey_run_id?: unknown; sender_user_id?: unknown }): Lane {
  return m.campaign_recipient_id || m.journey_run_id ? 'bulk' : 'chat';
}

/**
 * Decide whether this message may go now. Counting happens whether or not it is allowed only when it IS allowed, so a held message does not use up the share it is waiting for.
 */
export async function decide(store: FairShareStore, tenantId: string, lane: Lane, nowMs: number, cfg: FairShareConfig = DEFAULT_FAIR_SHARE): Promise<FairShareDecision> {
  if (lane === 'chat') return { allow: true, retryAfterMs: 0 };
  const second = Math.floor(nowMs / 1000);
  const others = await store.othersActive(tenantId, second) + await store.othersActive(tenantId, second - 1);
  const limit = others > 0 ? Math.min(cfg.sharePerSecond, cfg.budgetPerSecond) : cfg.budgetPerSecond;
  const used = await store.bump(tenantId, second);
  if (used > limit) return { allow: false, retryAfterMs: cfg.retryAfterMs, reason: 'share_used' };
  return { allow: true, retryAfterMs: 0 };
}

/** In-memory store for tests and for a single process. */
export class MemoryFairShareStore implements FairShareStore {
  private counts = new Map<string, number>();
  async bump(tenantId: string, second: number) { const k = `${second}:${tenantId}`; const n = (this.counts.get(k) ?? 0) + 1; this.counts.set(k, n); this.prune(second); return n; }
  async othersActive(tenantId: string, second: number) {
    let n = 0; for (const k of this.counts.keys()) { const [s, t] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)]; if (Number(s) === second && t !== tenantId) n++; } return n;
  }
  private prune(second: number) { if (this.counts.size < 5000) return; for (const k of this.counts.keys()) if (Number(k.slice(0, k.indexOf(':'))) < second - 5) this.counts.delete(k); }
}
