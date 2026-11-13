import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { db, requireCtx } from '@/lib/session';

export const metadata: Metadata = { title: 'Activity log' };
export const dynamic = 'force-dynamic';

type Row = { id: number; action: string; entity: string | null; actor_type: string; who: string | null; created_at: string; after: Record<string, unknown> | null };
const LABELS: Record<string, string> = {
  'workspace.updated': 'Updated the business profile', 'member.invited': 'Invited a teammate', 'member.removed': 'Removed a teammate', 'member.role_changed': 'Changed a role',
  'template.submitted': 'Submitted a message format', 'template.deleted': 'Deleted a message format', 'campaign.created': 'Created a campaign', 'campaign.queued': 'Sent or scheduled a campaign', 'campaign.sent_test': 'Sent a test message',
  'contacts.exported': 'Exported contacts', 'contacts.deleted': 'Deleted contacts', 'group.deleted': 'Deleted a group', 'renewal.marked_paid': 'Marked a renewal paid',
  'meta.connect_finished': 'Connected WhatsApp', 'meta.disconnected': 'Disconnected WhatsApp', 'lead_source.created': 'Added a lead source', 'lead_source.deleted': 'Deleted a lead source', 'lead_source.key_rotated': 'Replaced a lead source key',
  'lead_form.created': 'Created a lead form', 'lead_form.deleted': 'Deleted a lead form', 'lead_import.started': 'Imported a list of leads',
};
const label = (a: string) => LABELS[a] ?? a.replace(/[._]/g, ' ').replace(/^./, (c) => c.toUpperCase());
const KEEP = new Set(['name', 'title', 'role', 'rows', 'plan', 'count']);

export default async function ActivityPage() {
  const ctx = await requireCtx();
  if (ctx.role !== 'owner' && ctx.role !== 'admin') redirect('/dashboard');
  const rows = await db(ctx, async (tx) => (await tx.execute(sql`select a.id, a.action, a.entity, a.actor_type, u.name as who, a.created_at, a.after from audit_log a left join "user" u on u.id = a.actor_user_id order by a.id desc limit 150`)) as unknown as Row[]);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div><h2 className="font-display text-2xl font-extrabold">Activity log</h2><p className="text-sm text-muted">The latest 150 changes in this workspace. It cannot be edited or deleted.</p></div>
      {rows.length === 0 ? <div className="card p-8 text-center text-sm text-muted">Nothing recorded yet.</div> : (
        <ul className="card divide-y divide-line">
          {rows.map((r) => {
            const bits = Object.entries(r.after ?? {}).filter(([k, v]) => KEEP.has(k) && ['string', 'number'].includes(typeof v)).map(([k, v]) => `${k}: ${String(v)}`).join(' · ');
            return (
              <li key={r.id} className="flex flex-col gap-0.5 p-4 sm:flex-row sm:items-baseline sm:justify-between">
                <div className="min-w-0"><p className="font-medium">{label(r.action)}</p><p className="break-words text-xs text-muted">{r.who ?? (r.actor_type === 'user' ? 'A team member' : r.actor_type.replace(/_/g, ' '))}{bits ? ` · ${bits}` : ''}</p></div>
                <time className="shrink-0 text-xs text-muted" dateTime={new Date(r.created_at).toISOString()}>{new Date(r.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}</time>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
