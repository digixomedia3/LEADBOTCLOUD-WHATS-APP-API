import { Closures } from '@/components/admin/admin-views-2';
import { loadClosures } from '../actions';

export default async function ClosuresPage() {
  const r = await loadClosures();
  if (!r.ok) return <p role="alert" className="rounded-xl bg-rose/10 p-4 text-rose">{r.error}</p>;
  return <div className="flex flex-col gap-4"><div><h1 className="font-display text-2xl font-bold">Closures</h1><p className="text-sm text-muted">Workspaces whose owner asked to close. After 30 days everything is erased. You can stop a closure until the erasing starts.</p></div><Closures pending={r.data.pending} closed={r.data.closed} /></div>;
}
