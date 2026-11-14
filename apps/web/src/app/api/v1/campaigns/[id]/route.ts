import { okJson, problem, route } from '@/lib/api-route';
import { campaignStatusFor } from '@/lib/core/contacts';

export const GET = route('campaigns:read', async (ctx, _req, params) => { const r = await campaignStatusFor(ctx, params.id!); return r.ok ? okJson(r.data) : problem(404, r.error); });
