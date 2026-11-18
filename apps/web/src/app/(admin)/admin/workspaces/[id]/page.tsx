import { notFound } from 'next/navigation';
import { WorkspaceDetail } from '@/components/admin/admin-views';
import { WorkspaceExtra } from '@/components/admin/admin-views-2';
import { loadTenant, loadTenantExtra } from '../../actions';

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await loadTenant(id);
  if (!r.ok) return <p role="alert" className="rounded-xl bg-rose/10 p-4 text-rose">{r.error}</p>;
  if (!r.data) notFound();
  const x = await loadTenantExtra(id);
  return <div className="flex flex-col gap-5"><WorkspaceDetail t={r.data} />{x.ok ? <WorkspaceExtra id={id} initial={x.data} /> : <p role="alert" className="rounded-xl bg-rose/10 p-4 text-rose">{x.error}</p>}</div>;
}
