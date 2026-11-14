import { okJson, problem, readJson, route } from '@/lib/api-route';
import { addToGroupFor } from '@/lib/core/contacts';

export const POST = route('contacts:write', async (ctx, req, params) => {
  const b = await readJson(req); if (!b.ok) return b.res;
  const ids = (b.body as { contactIds?: unknown }).contactIds;
  if (!Array.isArray(ids)) return problem(422, 'Send {"contactIds": ["..."]}.');
  const r = await addToGroupFor(ctx, params.id!, ids as string[]);
  return r.ok ? okJson(r.data) : problem(422, r.error);
});
