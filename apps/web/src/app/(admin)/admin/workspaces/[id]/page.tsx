import { notFound } from 'next/navigation';
import { WorkspaceDetail } from '@/components/admin/admin-views';
import { WorkspaceExtra } from '@/components/admin/admin-views-2';
import { ViewAsCustomer } from '@/components/admin/view-as-customer';
import { PlanCard } from '@/components/admin/plan-card';
import { loadPlan, loadTenant, loadTenantExtra, loadViews } from '../../actions';

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await loadTenant(id);
  if (!r.ok) return <p role="alert" className="rounded-xl bg-rose/10 p-4 text-rose">{r.error}</p>;
  if (!r.data) notFound();
  const x = await loadTenantExtra(id);
  const v = await loadViews(id);
  const pl = await loadPlan(id);
  return <div className="flex flex-col gap-5"><WorkspaceDetail t={r.data} />{pl.ok && pl.data ? <PlanCard id={id} initial={pl.data} /> : null}<ViewAsCustomer tenantId={id} tenantName={r.data.name} closed={r.data.status === 'offboarded'} history={v.ok ? v.data : []} />{x.ok ? <WorkspaceExtra id={id} initial={x.data} /> : <p role="alert" className="rounded-xl bg-rose/10 p-4 text-rose">{x.error}</p>}</div>;
}
