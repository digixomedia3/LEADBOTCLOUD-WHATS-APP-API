import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ReportView } from '@/components/campaigns/report-view';
import { campaignRecipientsFor, campaignReportFor } from '@/lib/core/campaign-report';
import { requireCtx } from '@/lib/session';

export const metadata: Metadata = { title: 'Campaign report' };
export const dynamic = 'force-dynamic';

export default async function CampaignReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const report = await campaignReportFor(ctx, id);
  if (!report.ok) notFound();
  const first = await campaignRecipientsFor(ctx, id, 'all', 1);
  return <ReportView report={report.data} initial={first.ok ? first.data : { rows: [], total: 0, page: 1, pages: 1 }} canExport={ctx.role === 'owner' || ctx.role === 'admin'} />;
}
