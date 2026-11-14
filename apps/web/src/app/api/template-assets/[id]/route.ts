import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { db, requireCtx } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Serves a header file back to the signed-in workspace for previews. Row-level security means another workspace's id is simply "not found". */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 });
  const ctx = await requireCtx();
  const a = await db(ctx, async (tx) => ((await tx.execute(sql`select mime, file_name, data from template_assets where id = ${id}`)) as unknown as { mime: string; file_name: string; data: Buffer }[])[0]);
  if (!a) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(new Uint8Array(a.data), {
    headers: {
      'content-type': a.mime, 'content-disposition': `inline; filename="${a.file_name.replace(/[^\w. -]/g, '_')}"`,
      'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'cache-control': 'private, max-age=300',
    },
  });
}
