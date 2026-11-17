import { NextResponse } from 'next/server';
import { Forbidden, assertRole, audit, db, requireCtx } from '@/lib/session';
import { buildWorkspaceExport } from '@/lib/core/workspace-export';

export const dynamic = 'force-dynamic';

/** Downloads everything the workspace holds, as one JSON file. Owner only (it contains every customer's number and message), and every download is logged. */
export async function GET() {
  const ctx = await requireCtx();
  try { assertRole(ctx, 'owner'); } catch (e) { if (e instanceof Forbidden) return NextResponse.json({ error: 'Only the workspace owner can download everything.' }, { status: 403 }); throw e; }
  const r = await buildWorkspaceExport(ctx);
  await db(ctx, (tx) => audit(tx, 'workspace.exported', 'tenant', ctx.tenantId, r.counts));
  const safe = r.name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'workspace';
  return new NextResponse(JSON.stringify(r.file, null, 1), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${safe}-export.json"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
