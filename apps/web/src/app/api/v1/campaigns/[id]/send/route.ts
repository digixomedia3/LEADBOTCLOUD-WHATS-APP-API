import { okJson, problem, route } from '@/lib/api-route';
import { sendCampaignViaKey } from '@/lib/core/campaigns';

/** Starts the send. Needs the campaigns:send permission, the campaign must have been created by this same key, and the cost must be within the key's limits. */
export const POST = route('campaigns:send', async (ctx, _req, params) => { const r = await sendCampaignViaKey(ctx, params.id!); return r.ok ? okJson(r.data) : problem(422, r.error); });
