import { Announcements } from '@/components/admin/admin-views';
import { loadAnnouncements } from '../actions';

export default async function AnnouncementsPage() {
  const r = await loadAnnouncements();
  if (!r.ok) return <p role="alert" className="rounded-xl bg-rose/10 p-4 text-rose">{r.error}</p>;
  return <div className="flex flex-col gap-4"><h1 className="font-display text-2xl font-bold">Announcements</h1><Announcements initial={r.data} /></div>;
}
