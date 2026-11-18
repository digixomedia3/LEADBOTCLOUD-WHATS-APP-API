import { StaffList } from '@/components/admin/admin-views-2';
import { loadStaff } from '../actions';

export default async function StaffPage() {
  const r = await loadStaff();
  if (!r.ok) return <p role="alert" className="rounded-xl bg-rose/10 p-4 text-rose">{r.error}</p>;
  return <div className="flex flex-col gap-4"><h1 className="font-display text-2xl font-bold">Platform staff</h1><StaffList rows={r.data} /></div>;
}
