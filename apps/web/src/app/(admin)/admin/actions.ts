'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { sql } from 'drizzle-orm';
import { adminCall, one, requireAdmin } from '@/lib/admin';
import { VIEW_COOKIE } from '@/lib/session';

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (error: string): { ok: false; error: string } => ({ ok: false, error });

export interface Overview {
  tenants: Record<string, number>; plans: Record<string, number>; users: number; newTenants7d: number; connected: number; tokenProblems: number; restricted: number; flagged: number;
  messages24h: number; failed24h: number; queued: number; campaignsRunning: number; journeysRunning: number; webhookBacklog: number; webhookErrors24h: number;
  subs: Record<string, number>; mrrPaise: number;
}
export async function loadOverview(): Promise<Result<Overview>> {
  const a = await requireAdmin();
  return adminCall(a, async (tx) => one<Overview>(await tx.execute(sql`select public.admin_overview() as o`), 'o'));
}

export interface TenantRow { id: string; name: string; status: string; plan: string; vertical: string | null; review: string; createdAt: string; members: number; owner: string | null; contacts: number; sent30d: number; token: string | null; health: string | null; lastActive: string | null }
export async function loadTenants(search: string, status: string, page: number): Promise<Result<{ total: number; rows: TenantRow[]; pageSize: number }>> {
  const a = await requireAdmin();
  const pageSize = 25; const p = Math.max(1, Math.min(10_000, Math.floor(Number(page) || 1)));
  const st = ['pending_meta', 'onboarding', 'ready', 'suspended', 'offboarded'].includes(status) ? status : null;
  const r = await adminCall(a, async (tx) => one<{ total: number; rows: TenantRow[] }>(await tx.execute(sql`select public.admin_tenants(${String(search ?? '').slice(0, 80)}, ${st}, ${pageSize}, ${(p - 1) * pageSize}) as t`), 't'));
  return r.ok ? { ok: true, data: { ...r.data, pageSize } } : r;
}

export interface TenantDetail {
  id: string; name: string; legalName: string | null; gstin: string | null; status: string; plan: string; vertical: string | null; review: string; createdAt: string;
  suspendedReason: string | null; suspendedAt: string | null; suspendedFrom: string | null;
  members: { name: string; email: string; role: string }[];
  connection: null | { wabaId: string; token: string; health: string; payment: string; phone: null | { display: string | null; name: string | null; quality: string | null; status: string | null } };
  subscription: null | { plan: string; status: string; currentEnd: string | null; cancelAtCycleEnd: boolean };
  usage: { contacts: number; sent30d: number; failed30d: number; campaigns: number; templates: number; journeysActive: number };
  recent: { action: string; actor: string; at: string }[];
}
export async function loadTenant(id: string): Promise<Result<TenantDetail | null>> {
  const a = await requireAdmin(); if (!UUID.test(id)) return { ok: true, data: null };
  return adminCall(a, async (tx) => one<TenantDetail | null>(await tx.execute(sql`select public.admin_tenant(${id}::uuid) as t`), 't'));
}

export async function setSuspended(id: string, suspend: boolean, reason: string): Promise<Result<{ changed: boolean; campaignsPaused?: number; journeysPaused?: number }>> {
  const a = await requireAdmin(); if (!UUID.test(id)) return bad('That workspace id is not valid.');
  const r = await adminCall(a, async (tx) => one<{ changed: boolean; campaignsPaused?: number; journeysPaused?: number }>(await tx.execute(sql`select public.admin_set_suspended(${id}::uuid, ${!!suspend}, ${String(reason ?? '').slice(0, 300)}) as r`), 'r'));
  revalidatePath('/admin', 'layout'); return r;
}
export async function setPlan(id: string, plan: string, note: string): Promise<Result<{ changed: boolean }>> {
  const a = await requireAdmin(); if (!UUID.test(id)) return bad('That workspace id is not valid.');
  const r = await adminCall(a, async (tx) => one<{ changed: boolean }>(await tx.execute(sql`select public.admin_set_plan(${id}::uuid, ${String(plan)}, ${String(note ?? '').slice(0, 200)}) as r`), 'r'));
  revalidatePath('/admin', 'layout'); return r;
}
export async function setReview(id: string, review: string): Promise<Result<{ changed: boolean }>> {
  const a = await requireAdmin(); if (!UUID.test(id)) return bad('That workspace id is not valid.');
  const r = await adminCall(a, async (tx) => one<{ changed: boolean }>(await tx.execute(sql`select public.admin_set_review(${id}::uuid, ${String(review)}) as r`), 'r'));
  revalidatePath('/admin', 'layout'); return r;
}

export interface AuditRow { id: number; at: string; tenantId: string | null; tenant: string | null; actorType: string; actor: string | null; action: string; entity: string | null; after: unknown }
export async function loadAudit(before: number | null, tenant: string, prefix: string): Promise<Result<AuditRow[]>> {
  const a = await requireAdmin();
  const t = UUID.test(tenant) ? tenant : null; const b = before !== null && Number.isFinite(before) && before > 0 ? Math.floor(before) : null;
  return adminCall(a, async (tx) => one<AuditRow[]>(await tx.execute(sql`select public.admin_audit(50, ${b}::bigint, ${t}::uuid, ${String(prefix ?? '').slice(0, 40)}) as r`), 'r'));
}

export interface AnnouncementRow { id: string; message: string; level: string; active: boolean; endsAt: string | null; createdAt: string }
export async function loadAnnouncements(): Promise<Result<AnnouncementRow[]>> {
  const a = await requireAdmin();
  return adminCall(a, async (tx) => one<AnnouncementRow[]>(await tx.execute(sql`select public.admin_announcements() as r`), 'r'));
}
export async function announce(message: string, level: string, hours: number | null): Promise<Result<{ id: string }>> {
  const a = await requireAdmin();
  const h = hours === null || hours === undefined ? null : Math.floor(Number(hours));
  const r = await adminCall(a, async (tx) => ({ id: one<string>(await tx.execute(sql`select public.admin_announce(${String(message ?? '').slice(0, 400)}, ${String(level)}, ${h}::int) as r`), 'r') }));
  revalidatePath('/', 'layout'); return r;
}
export async function endAnnouncement(id: string): Promise<Result<{ ended: boolean }>> {
  const a = await requireAdmin(); if (!UUID.test(id)) return bad('That announcement id is not valid.');
  const r = await adminCall(a, async (tx) => ({ ended: one<boolean>(await tx.execute(sql`select public.admin_end_announcement(${id}::uuid) as r`), 'r') }));
  revalidatePath('/', 'layout'); return r;
}

/* ------------------------------------------------------------------ round two: attention, closures, accounts, revenue, staff, notes */
export interface AttentionReason { code: string; severity: 'high' | 'warn' | 'info'; weight: number; detail: string }
export interface AttentionRow { id: string; name: string; status: string; plan: string; owner: string | null; reasons: AttentionReason[]; score: number }
export async function loadAttention(): Promise<Result<AttentionRow[]>> {
  const a = await requireAdmin();
  return adminCall(a, async (tx) => one<AttentionRow[]>(await tx.execute(sql`select public.admin_attention() as r`), 'r'));
}

export interface ClosureRow { id: string; name: string; status: string; plan: string; requestedAt: string; dueAt: string; requestedBy: string | null; daysLeft: number; inProgress: boolean; contacts: number; members: number }
export interface ClosedRow { id: string; name: string; plan: string; closedAt: string; requestedAt: string | null }
export async function loadClosures(): Promise<Result<{ pending: ClosureRow[]; closed: ClosedRow[] }>> {
  const a = await requireAdmin();
  return adminCall(a, async (tx) => one<{ pending: ClosureRow[]; closed: ClosedRow[] }>(await tx.execute(sql`select public.admin_closures() as r`), 'r'));
}
export async function cancelClosure(id: string, reason: string): Promise<Result<{ changed: boolean }>> {
  const a = await requireAdmin(); if (!UUID.test(id)) return bad('That workspace id is not valid.');
  const r = await adminCall(a, async (tx) => one<{ changed: boolean }>(await tx.execute(sql`select public.admin_cancel_closure(${id}::uuid, ${String(reason ?? '').slice(0, 300)}) as r`), 'r'));
  revalidatePath('/admin', 'layout'); return r;
}

export interface UserRow { id: string; name: string; email: string; verified: boolean; createdAt: string; staff: boolean; sessions: number; lastSeen: string | null; workspaces: { id: string; name: string; role: string; status: string }[] }
export async function searchUsers(search: string): Promise<Result<UserRow[]>> {
  const a = await requireAdmin();
  return adminCall(a, async (tx) => one<UserRow[]>(await tx.execute(sql`select public.admin_users(${String(search ?? '').slice(0, 80)}, 25) as r`), 'r'));
}
export async function signOutUser(userId: string, reason: string): Promise<Result<{ ended: number }>> {
  const a = await requireAdmin(); const id = String(userId ?? '');
  if (!id || id.length > 100) return bad('That account id is not valid.');
  const r = await adminCall(a, async (tx) => one<{ ended: number }>(await tx.execute(sql`select public.admin_sign_out_user(${id}, ${String(reason ?? '').slice(0, 300)}) as r`), 'r'));
  revalidatePath('/admin', 'layout'); return r;
}

export interface Revenue {
  byPlan: { plan: string; count: number; paise: number; unpriced: number }[]; subs: Record<string, number>;
  months: { month: string; count: number; basePaise: number; gstPaise: number; totalPaise: number }[];
  renewals: { id: string; name: string; plan: string; end: string; cancelAtEnd: boolean }[];
  recent: { number: string; tenantId: string; tenant: string | null; totalPaise: number; at: string }[];
}
export async function loadRevenue(): Promise<Result<Revenue>> {
  const a = await requireAdmin();
  return adminCall(a, async (tx) => one<Revenue>(await tx.execute(sql`select public.admin_revenue() as r`), 'r'));
}

export interface StaffRow { id: string; name: string; email: string; since: string; addedBy: string | null; actions30d: number; lastAction: string | null; sessions: number }
export async function loadStaff(): Promise<Result<StaffRow[]>> {
  const a = await requireAdmin();
  return adminCall(a, async (tx) => one<StaffRow[]>(await tx.execute(sql`select public.admin_staff() as r`), 'r'));
}

export interface TenantExtra { notes: { id: string; note: string; by: string | null; at: string }[]; errors: { code: number | null; count: number; last: string }[]; closure: null | { requestedAt: string; dueAt: string; closedAt: string | null; requestedBy: string | null } }
export async function loadTenantExtra(id: string): Promise<Result<TenantExtra>> {
  const a = await requireAdmin(); if (!UUID.test(id)) return bad('That workspace id is not valid.');
  return adminCall(a, async (tx) => one<TenantExtra>(await tx.execute(sql`select public.admin_tenant_extra(${id}::uuid) as r`), 'r'));
}
export async function addNote(id: string, note: string): Promise<Result<{ id: string }>> {
  const a = await requireAdmin(); if (!UUID.test(id)) return bad('That workspace id is not valid.');
  // Refuse a long note instead of cutting it: a note that quietly loses its end is worse than one that is rejected.
  if (String(note ?? '').trim().length > 1000) return bad('A note can be up to 1000 characters. Shorten it and try again.');
  const r = await adminCall(a, async (tx) => ({ id: one<string>(await tx.execute(sql`select public.admin_add_note(${id}::uuid, ${String(note ?? '')}) as r`), 'r') }));
  revalidatePath(`/admin/workspaces/${id}`); return r;
}

// ---- Read-only "view as customer" ----
export interface ViewRow { id: string; staff: string; reason: string; startedAt: string; endedAt: string | null; expiresAt: string }
export async function loadViews(tenantId: string): Promise<Result<ViewRow[]>> {
  const a = await requireAdmin(); if (!UUID.test(tenantId)) return { ok: true, data: [] };
  return adminCall(a, async (tx) => one<ViewRow[]>(await tx.execute(sql`select public.admin_view_history(${tenantId}::uuid, 20) as h`), 'h'));
}

/** Starts a 30-minute read-only view of one workspace. The reason is required and is shown to the customer in their Activity log. */
export async function startView(tenantId: string, reason: string): Promise<Result<{ tenantName: string }>> {
  const a = await requireAdmin(); if (!UUID.test(tenantId)) return bad('That workspace id is not valid.');
  const r = await adminCall(a, async (tx) => one<{ id: string; tenantName: string }>(await tx.execute(sql`select public.admin_view_start(${tenantId}::uuid, ${String(reason ?? '').slice(0, 400)}) as v`), 'v'));
  if (!r.ok) return r;
  (await cookies()).set(VIEW_COOKIE, r.data.id, { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 30 * 60 });
  return { ok: true, data: { tenantName: r.data.tenantName } };
}

/** Ends the current view. Works even if the cookie is gone: the database ends any live view of this staff member. */
export async function endView(): Promise<Result<{ ended: boolean }>> {
  const a = await requireAdmin(); const jar = await cookies(); const id = jar.get(VIEW_COOKIE)?.value;
  jar.delete(VIEW_COOKIE);
  if (!id || !UUID.test(id)) return { ok: true, data: { ended: false } };
  return adminCall(a, async (tx) => one<{ ended: boolean }>(await tx.execute(sql`select public.admin_view_end(${id}::uuid) as e`), 'e'));
}
