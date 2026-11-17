'use server';

import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { adminCall, one, requireAdmin } from '@/lib/admin';

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
