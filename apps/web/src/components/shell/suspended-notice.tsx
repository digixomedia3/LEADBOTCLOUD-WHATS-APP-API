import { sql } from 'drizzle-orm';
import { db, type ActorCtx } from '@/lib/tenant-db';

/** Shown on every page while the platform team has switched sending off for this workspace. Says why, in plain words, so the owner is never left guessing. */
export async function SuspendedNotice({ ctx }: { ctx: ActorCtx }) {
  let row: { status: string; reason: string | null } | undefined;
  try { row = ((await db(ctx, (tx) => tx.execute(sql`select status, suspended_reason as reason from tenants where id = ${ctx.tenantId}::uuid`))) as unknown as { status: string; reason: string | null }[])[0]; } catch { return null; }
  if (!row || row.status !== 'suspended') return null;
  return (
    <div role="alert" className="border-b border-rose/30 bg-rose/10 px-4 py-3 text-center text-sm text-rose">
      <strong>Sending is switched off for this workspace.</strong> Your campaigns and journeys are paused and nothing will be sent until it is reactivated.
      {row.reason ? <> Reason given: {row.reason}.</> : null} Contact support to get it back on.
    </div>
  );
}
