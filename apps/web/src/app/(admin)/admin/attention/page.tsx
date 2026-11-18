import { AttentionList } from '@/components/admin/admin-views-2';
import { loadAttention } from '../actions';

export default async function AttentionPage() {
  const r = await loadAttention();
  if (!r.ok) return <p role="alert" className="rounded-xl bg-rose/10 p-4 text-rose">{r.error}</p>;
  return <div className="flex flex-col gap-4"><div><h1 className="font-display text-2xl font-bold">Needs attention</h1><p className="text-sm text-muted">Workspaces with something wrong, worst first. Failing sends are counted over the last 7 days.</p></div><AttentionList rows={r.data} /></div>;
}
