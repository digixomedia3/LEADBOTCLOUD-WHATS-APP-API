import { okJson, problem, route } from '@/lib/api-route';
import { listApprovedTemplatesFor } from '@/lib/core/contacts';

export const GET = route('templates:read', async (ctx) => { const r = await listApprovedTemplatesFor(ctx); return r.ok ? okJson(r.data) : problem(400, r.error); });
