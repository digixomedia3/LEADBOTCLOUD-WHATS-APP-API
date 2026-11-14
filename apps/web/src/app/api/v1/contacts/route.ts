import { okJson, problem, readJson, route } from '@/lib/api-route';
import { addContactFor, searchContactsFor } from '@/lib/core/contacts';

export const GET = route('contacts:read', async (ctx, req) => {
  const u = new URL(req.url);
  const r = await searchContactsFor(ctx, { q: u.searchParams.get('q') ?? undefined, tag: u.searchParams.get('tag') ?? undefined, groupId: u.searchParams.get('group') ?? undefined, limit: Number(u.searchParams.get('limit') ?? 20) });
  return r.ok ? okJson(r.data) : problem(400, r.error);
});

/** Adds ONE contact. "consent": true and "source" are required: the caller is stating that this person agreed to WhatsApp messages. */
export const POST = route('contacts:write', async (ctx, req) => {
  const b = await readJson(req); if (!b.ok) return b.res;
  const r = await addContactFor(ctx, b.body as never);
  return r.ok ? okJson(r.data, 201) : problem(422, r.error);
});
