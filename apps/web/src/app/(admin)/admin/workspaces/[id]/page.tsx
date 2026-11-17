import { notFound } from 'next/navigation';
import { WorkspaceDetail } from '@/components/admin/admin-views';
import { loadTenant } from '../../actions';

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await loadTenant(id);
  if (!r.ok) return <p role="alert" className="rounded-xl bg-rose/10 p-4 text-rose">{r.error}</p>;
  if (!r.data) notFound();
  return <WorkspaceDetail t={r.data} />;
}
