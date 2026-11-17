import { WorkspacesList } from '@/components/admin/admin-views';
import { loadTenants } from '../actions';

export default async function WorkspacesPage() {
  const r = await loadTenants('', '', 1);
  if (!r.ok) return <p role="alert" className="rounded-xl bg-rose/10 p-4 text-rose">{r.error}</p>;
  return <div className="flex flex-col gap-4"><h1 className="font-display text-2xl font-bold">Workspaces</h1><WorkspacesList initial={r.data.rows} total={r.data.total} pageSize={r.data.pageSize} /></div>;
}
