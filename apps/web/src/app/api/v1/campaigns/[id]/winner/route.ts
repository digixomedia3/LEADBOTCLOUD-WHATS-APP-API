import { okJson, problem, readJson, route } from '@/lib/api-route';
import { releaseWinnerViaKey } from '@/lib/core/campaigns';

/**
 * Chooses which version of a "test first" campaign goes to everyone who was kept back. Needs the campaigns:send permission (it sends to real customers),
 * and the campaign must have been created AND started by this same key, so its cost is already inside the key's limits. Body: { "version": "a" | "b" }.
 */
export const POST = route('campaigns:send', async (ctx, req, params) => {
  const b = await readJson(req); if (!b.ok) return b.res;
  const version = (b.body as { version?: unknown } | null)?.version;
  if (version !== 'a' && version !== 'b') return problem(422, 'Send {"version": "a"} or {"version": "b"}.');
  const r = await releaseWinnerViaKey(ctx, params.id!, version);
  return r.ok ? okJson(r.data) : problem(422, r.error);
});
