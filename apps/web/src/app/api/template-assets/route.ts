import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { checkHeaderMedia, MEDIA_LIMITS, safeFileName, type MediaKind } from '@lbc/shared';
import { Forbidden, assertRole, db, requireCtx } from '@/lib/session';

export const dynamic = 'force-dynamic';
const json = (o: unknown, status = 200) => NextResponse.json(o, { status, headers: { 'cache-control': 'no-store' } });
const MAX_ASSETS_PER_WORKSPACE = 100;

/**
 * Receives the picture / video / PDF for a template header. A route handler, not a server action, because actions are limited to about 1 MB.
 * The file's type comes from its own bytes, never from the name or the type the browser claims. Owners and admins only.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx();
  try { assertRole(ctx, 'admin'); } catch (e) { if (e instanceof Forbidden) return json({ ok: false, error: 'Only an owner or admin can add header files.' }, 403); throw e; }
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (!Number.isFinite(declared) || declared > 17 * 1024 * 1024) return json({ ok: false, error: 'That file is too large. The limit is 16 MB.' }, 413);

  let form: FormData;
  try { form = await req.formData(); } catch { return json({ ok: false, error: 'Could not read the upload. Try again.' }, 400); }
  const kind = String(form.get('kind') ?? '') as MediaKind;
  const file = form.get('file');
  if (!(kind in MEDIA_LIMITS)) return json({ ok: false, error: 'Choose the header type first.' }, 400);
  if (!(file instanceof File)) return json({ ok: false, error: 'Choose a file.' }, 400);
  if (file.size > MEDIA_LIMITS[kind].maxBytes) return json({ ok: false, error: `This file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${MEDIA_LIMITS[kind].maxBytes / 1048576} MB.` }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const c = checkHeaderMedia(bytes, kind);
  if (!c.ok) return json({ ok: false, error: c.error }, 422);
  const name = safeFileName(file.name || 'header', c.ext);
  const sha = createHash('sha256').update(bytes).digest('hex');

  const r = await db(ctx, async (tx) => {
    const n = ((await tx.execute(sql`select count(*)::int as n from template_assets`)) as unknown as { n: number }[])[0]!.n;
    if (n >= MAX_ASSETS_PER_WORKSPACE) return null;
    return ((await tx.execute(sql`insert into template_assets (tenant_id, kind, mime, file_name, size_bytes, sha256, data, created_by)
      values (${ctx.tenantId}, ${c.kind}, ${c.mime}, ${name}, ${c.size}, ${sha}, ${Buffer.from(bytes)}, ${ctx.user.id}) returning id`)) as unknown as { id: string }[])[0]!.id;
  });
  if (!r) return json({ ok: false, error: 'You have reached the limit of saved header files. Delete unused templates first.' }, 409);
  return json({ ok: true, asset: { id: r, kind: c.kind, name, size: c.size } });
}
