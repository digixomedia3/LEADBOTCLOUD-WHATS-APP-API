import { RevenueView } from '@/components/admin/admin-views-2';
import { loadRevenue } from '../actions';

export default async function RevenuePage() {
  const r = await loadRevenue();
  if (!r.ok) return <p role="alert" className="rounded-xl bg-rose/10 p-4 text-rose">{r.error}</p>;
  return <div className="flex flex-col gap-4"><h1 className="font-display text-2xl font-bold">Revenue</h1><RevenueView r={r.data} /></div>;
}
