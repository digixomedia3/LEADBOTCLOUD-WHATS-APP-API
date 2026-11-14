import { okJson, problem, route } from '@/lib/api-route';
import { campaignReportFor } from '@/lib/core/campaign-report';

export const GET = route('campaigns:read', async (ctx, _req, params) => { const r = await campaignReportFor(ctx, params.id!); return r.ok ? okJson(r.data) : problem(404, r.error); });
