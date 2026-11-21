/**
 * Closing a workspace, from the owner's side. The two database functions do the real checking (owner only, exact name typed, plan cancelled first),
 * so a request cannot get past them however it arrives. This file only turns their refusals into plain sentences.
 */
import { sql } from 'drizzle-orm';
import { db, type ActorCtx } from '@/lib/tenant-db';
import { sendClosureCancelledMail, sendClosureRequestedMail } from '@/lib/notify';

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
export interface ClosureInfo { requestedAt: string | null; dueAt: string | null; closedAt: string | null; daysLeft: number | null; workspaceName: string }

const SAY: [RegExp, string][] = [
  [/only the owner/i, 'Only the workspace owner can do this.'],
  [/type the workspace name/i, 'Type the workspace name exactly to confirm.'],
  [/cancel your plan first/i, 'Cancel your paid plan first (Plan and billing), so you are not charged again. Then you can close the workspace.'],
  [/already closed/i, 'This workspace is already closed.'],
  [/not signed in/i, 'Please sign in again.'],
];
const plain = (e: unknown) => { const m = String((e as { message?: string; cause?: { message?: string } })?.cause?.message ?? (e as Error)?.message ?? ''); return SAY.find(([re]) => re.test(m))?.[1] ?? 'Could not do that. Nothing was changed.'; };

export async function loadClosure(ctx: ActorCtx): Promise<ClosureInfo> {
  const r = ((await db(ctx, (tx) => tx.execute(sql`select name, closure_requested_at, closure_due_at, closed_at from tenants where id = ${ctx.tenantId}::uuid`))) as unknown as { name: string; closure_requested_at: Date | null; closure_due_at: Date | null; closed_at: Date | null }[])[0];
  const due = r?.closure_due_at ? new Date(r.closure_due_at) : null;
  return { workspaceName: r?.name ?? '', requestedAt: r?.closure_requested_at ? new Date(r.closure_requested_at).toISOString() : null, dueAt: due ? due.toISOString() : null, closedAt: r?.closed_at ? new Date(r.closed_at).toISOString() : null,
    daysLeft: due ? Math.max(0, Math.ceil((due.getTime() - Date.now()) / 86_400_000)) : null };
}

export async function requestClosure(ctx: ActorCtx, confirmName: string): Promise<Result<{ dueAt: string }>> {
  if (ctx.role !== 'owner') return { ok: false, error: 'Only the workspace owner can do this.' };
  try { const due = ((await db(ctx, (tx) => tx.execute(sql`select public.request_workspace_closure(${String(confirmName ?? '').slice(0, 200)}) as due`))) as unknown as { due: Date }[])[0]!.due; const dueAt = new Date(due);
    // Tell the owner in writing, so a request made from a stolen session cannot go unnoticed. Failure to send must not undo the request.
    if (ctx.user.email) await sendClosureRequestedMail({ to: ctx.user.email, workspace: ctx.workspace.name, dueAt }).catch(() => undefined);
    return { ok: true, data: { dueAt: dueAt.toISOString() } }; }
  catch (e) { return { ok: false, error: plain(e) }; }
}

export async function cancelClosure(ctx: ActorCtx): Promise<Result<{ cancelled: boolean }>> {
  if (ctx.role !== 'owner') return { ok: false, error: 'Only the workspace owner can do this.' };
  try { const n = ((await db(ctx, (tx) => tx.execute(sql`select public.cancel_workspace_closure() as n`))) as unknown as { n: boolean }[])[0]!.n; if (n && ctx.user.email) await sendClosureCancelledMail({ to: ctx.user.email, workspace: ctx.workspace.name }).catch(() => undefined);
    return { ok: true, data: { cancelled: !!n } }; }
  catch (e) { return { ok: false, error: plain(e) }; }
}
