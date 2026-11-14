import { NextResponse } from 'next/server';
import { RECIPIENT_CSV_HEADER, recipientCsvRow } from '@lbc/shared/campaign-report';
import { toCsv } from '@/lib/contacts/import';
import { campaignExportRows, RESULT_FILTERS, type ResultFilter } from '@/lib/core/campaign-report';
import { Forbidden, assertRole, audit, db, requireCtx } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Downloads the people in a campaign as a spreadsheet. Phone numbers are personal data, so only the owner or an admin can, and every download is logged. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  try { assertRole(ctx, 'admin'); } catch (e) {
    if (e instanceof Forbidden) return NextResponse.json({ error: 'Only the owner or an admin can download this.' }, { status: 403 });
    throw e;
  }
  const { id } = await params;
  const f = new URL(req.url).searchParams.get('result') ?? 'all';
  const filter = (RESULT_FILTERS as readonly string[]).includes(f) ? (f as ResultFilter) : 'all';
  const r = await campaignExportRows(ctx, id, filter);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 404 });
  await db(ctx, (tx) => audit(tx, 'campaign.exported', 'campaign', id, { rows: r.data.rows.length, result: filter }));
  const lines = [[...RECIPIENT_CSV_HEADER], ...r.data.rows.map(recipientCsvRow)];
  if (r.data.truncated) lines.push([`Only the first 50,000 people are included.`]);
  const safe = r.data.name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'campaign';
  return new NextResponse('\ufeff' + toCsv(lines), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${safe}-${filter}.csv"`, 'cache-control': 'no-store' },
  });
}
