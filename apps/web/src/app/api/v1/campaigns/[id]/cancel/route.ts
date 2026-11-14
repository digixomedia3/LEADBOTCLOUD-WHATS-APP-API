import { okJson, problem, route } from '@/lib/api-route';
import { cancelCampaignFor } from '@/lib/core/campaigns';

export const POST = route('campaigns:write', async (ctx, _req, params) => { const r = await cancelCampaignFor(ctx, params.id!); return r.ok ? okJson({ cancelled: true }) : problem(422, r.error); });
