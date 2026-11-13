import type { Metadata } from 'next';
import { LeadsView } from '@/components/leads/leads-view';
import { requireCtx } from '@/lib/session';
import { listLeads } from './actions';

export const metadata: Metadata = { title: 'Leads' };
export const dynamic = 'force-dynamic';

export default async function LeadsPage() {
  const ctx = await requireCtx();
  const initial = await listLeads({ page: 1 });
  return <LeadsView initial={initial} canManage={ctx.role === 'owner' || ctx.role === 'admin'} canWrite={ctx.role !== 'viewer'} />;
}
