import { okJson, problem, readJson, route } from '@/lib/api-route';
import { createGroupFor, listGroupsFor } from '@/lib/core/contacts';

export const GET = route('contacts:read', async (ctx) => { const r = await listGroupsFor(ctx); return r.ok ? okJson(r.data) : problem(400, r.error); });
export const POST = route('contacts:write', async (ctx, req) => {
  const b = await readJson(req); if (!b.ok) return b.res;
  const name = (b.body as { name?: unknown }).name;
  if (typeof name !== 'string') return problem(422, 'Send {"name": "..."}.');
  const r = await createGroupFor(ctx, name);
  return r.ok ? okJson(r.data, 201) : problem(422, r.error);
});
