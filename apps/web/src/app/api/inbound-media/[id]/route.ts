import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { serveAs } from '@lbc/shared/inbound-media';
import { db, requireCtx } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Serves a file a customer sent, to the signed-in team of the workspace that received it. Row-level security makes another workspace's id plain "not found".
 * The customer controls every byte, so it is only ever shown in the page for a short list of safe types; everything else downloads. The sandboxing headers stop
 * even a mislabelled file from running anything.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 });
  const ctx = await requireCtx();
  const m = await db(ctx, async (tx) => ((await tx.execute(sql`select kind, mime, file_name, data from inbound_media where id = ${id} and state = 'stored'`)) as unknown as { kind: string; mime: string | null; file_name: string | null; data: Buffer }[])[0]);
  if (!m) return new NextResponse('Not found', { status: 404 });
  const how = serveAs(m.mime, m.kind, m.file_name);
  return new NextResponse(new Uint8Array(m.data), {
    headers: { 'content-type': how.contentType, 'content-disposition': how.disposition, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'cross-origin-resource-policy': 'same-origin', 'cache-control': 'private, max-age=300' },
  });
}
