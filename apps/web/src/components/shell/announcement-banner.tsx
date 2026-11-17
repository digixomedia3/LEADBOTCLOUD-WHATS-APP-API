import { sql } from 'drizzle-orm';
import { withUser } from '@lbc/db';
import { appDb } from '@/lib/tenant-db';

const TONE: Record<string, string> = { info: 'bg-indigo/10 text-ink', warning: 'bg-amber/15 text-ink', critical: 'bg-rose/15 text-rose' };

/** Messages from the platform team. A failure to load them must never break the app, so errors just show nothing. */
export async function AnnouncementBanner({ userId }: { userId: string }) {
  let rows: { id: string; message: string; level: string }[] = [];
  try { rows = (await withUser(appDb, userId, (tx) => tx.execute(sql`select id, message, level from announcements order by created_at desc limit 3`))) as unknown as typeof rows; } catch { return null; }
  if (!rows.length) return null;
  return <div className="flex flex-col" role="region" aria-label="Announcements">{rows.map((a) => <p key={a.id} role={a.level === 'critical' ? 'alert' : 'status'} className={`px-4 py-2 text-center text-sm font-semibold ${TONE[a.level] ?? TONE.info}`}>{a.message}</p>)}</div>;
}
