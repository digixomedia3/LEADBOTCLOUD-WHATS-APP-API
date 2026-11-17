import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { db, requireCtx } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Shows the team a file they sent (the type was checked from its bytes when it was saved, and is one of four). Another workspace's id is plain "not found". */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 });
  const ctx = await requireCtx();
  const a = await db(ctx, async (tx) => ((await tx.execute(sql`select mime, file_name, kind, data from message_attachments where id = ${id}`)) as unknown as { mime: string; file_name: string; kind: string; data: Buffer }[])[0]);
  if (!a) return new NextResponse('Not found', { status: 404 });
  const inline = a.kind !== 'document';
  return new NextResponse(new Uint8Array(a.data), { headers: {
    'content-type': a.mime, 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${a.file_name.replace(/[^\w. -]/g, '_')}"`,
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'cross-origin-resource-policy': 'same-origin', 'cache-control': 'private, max-age=300' } });
}
