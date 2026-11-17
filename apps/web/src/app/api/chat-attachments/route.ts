import { NextResponse, type NextRequest } from 'next/server';
import { Forbidden, assertRole, requireCtx } from '@/lib/session';
import { sendChatFile } from '@/lib/core/chat-files';

export const dynamic = 'force-dynamic';
const json = (o: unknown, status = 200) => NextResponse.json(o, { status, headers: { 'cache-control': 'no-store' } });

/** Receives a file typed into a chat. A route handler (server actions are limited to about 1 MB). Any team member who may reply may send a file. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx();
  try { assertRole(ctx, 'agent'); } catch (e) { if (e instanceof Forbidden) return json({ ok: false, error: 'Your role can view chats but not reply.' }, 403); throw e; }
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (!Number.isFinite(declared) || declared > 17 * 1024 * 1024) return json({ ok: false, error: 'That file is too large. The limit is 16 MB.' }, 413);
  let form: FormData; try { form = await req.formData(); } catch { return json({ ok: false, error: 'Could not read the upload. Try again.' }, 400); }
  const file = form.get('file'); const conv = String(form.get('conversationId') ?? '');
  if (!(file instanceof File)) return json({ ok: false, error: 'Choose a file.' }, 400);
  if (file.size > 16 * 1024 * 1024) return json({ ok: false, error: 'That file is too large. The limit is 16 MB.' }, 413);
  const r = await sendChatFile(ctx, conv, new Uint8Array(await file.arrayBuffer()), file.name, form.get('caption'));
  return json(r, r.ok ? 200 : 422);
}
