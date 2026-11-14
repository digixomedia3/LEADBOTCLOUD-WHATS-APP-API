import { okJson, problem, readJson, route } from '@/lib/api-route';
import { createCampaignFor } from '@/lib/core/campaigns';
import { listCampaignsFor } from '@/lib/core/contacts';

export const GET = route('campaigns:read', async (ctx) => { const r = await listCampaignsFor(ctx); return r.ok ? okJson(r.data) : problem(400, r.error); });

/** Creates a campaign. It does NOT send it: a separate call with the campaigns:send permission starts the send. */
export const POST = route('campaigns:write', async (ctx, req) => {
  const b = await readJson(req); if (!b.ok) return b.res;
  const r = await createCampaignFor(ctx, b.body as never);
  return r.ok ? okJson(r.data, 201) : problem(422, r.error);
});
