'use server';

import { createHash, randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { planLimits } from '@lbc/shared';
import { checkQuietHours } from '@lbc/shared/send-window';
import { invitations, tenantMembers, tenants, user } from '@lbc/db';
import { Forbidden, WORKSPACE_COOKIE, appDb, assertRole, audit, db, getSession, requireCtx, type Ctx } from '@/lib/session';

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
async function guard(min: 'admin' | 'owner' = 'admin'): Promise<{ ctx: Ctx } | { error: string }> {
  const ctx = await requireCtx();
  try { assertRole(ctx, min); } catch (e) { if (e instanceof Forbidden) return { error: min === 'owner' ? 'Only the workspace owner can do this.' : 'Your role cannot do this. Ask the workspace owner.' }; throw e; }
  return { ctx };
}
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

export interface MemberRow { userId: string; name: string; email: string; role: string; you: boolean }
export interface InviteRow { id: string; email: string | null; role: string; expiresAt: string }
export async function loadTeam(): Promise<{ members: MemberRow[]; invites: InviteRow[]; seats: number; used: number }> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => {
    const m = await tx.select({ userId: tenantMembers.userId, role: tenantMembers.role, name: user.name, email: user.email }).from(tenantMembers).innerJoin(user, eq(user.id, tenantMembers.userId)).where(eq(tenantMembers.tenantId, ctx.tenantId));
    const inv = await tx.select().from(invitations).where(and(isNull(invitations.acceptedAt), sql`${invitations.expiresAt} > now()`));
    const order = { owner: 0, admin: 1, agent: 2, viewer: 3 } as Record<string, number>;
    return {
      members: m.map((x) => ({ ...x, you: x.userId === ctx.user.id })).sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9) || a.name.localeCompare(b.name)),
      invites: inv.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() })),
      seats: planLimits(ctx.workspace.plan).users, used: m.length + inv.length,
    };
  });
}

const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email address.'), role: z.enum(['admin', 'agent', 'viewer']) });
/** Creates an invitation and returns a one-time link. Email delivery is not wired yet, so the owner shares the link. */
export async function inviteMember(input: z.input<typeof inviteSchema>): Promise<Result<{ link: string }>> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  const p = inviteSchema.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the email.');
  return db(g.ctx, async (tx) => {
    const team = await loadTeam();
    if (team.used >= team.seats) return fail(`Your plan allows ${team.seats} ${team.seats === 1 ? 'user' : 'users'}. Upgrade to invite more people.`);
    if (team.members.some((m) => m.email.toLowerCase() === p.data.email)) return fail('This person is already in your workspace.');
    if (team.invites.some((i) => i.email?.toLowerCase() === p.data.email)) return fail('This person already has a pending invitation.');
    const token = randomBytes(24).toString('base64url');
    await tx.insert(invitations).values({ tenantId: g.ctx.tenantId, email: p.data.email, role: p.data.role, tokenHash: hash(token), invitedBy: g.ctx.user.id, expiresAt: new Date(Date.now() + 7 * 86_400_000) });
    await audit(tx, 'member.invited', 'invitation', undefined, { role: p.data.role });
    revalidatePath('/settings');
    const base = process.env.APP_URL ?? 'http://localhost:3000';
    return { ok: true as const, data: { link: `${base}/invite/${token}` } };
  });
}
export async function revokeInvite(id: string): Promise<Result> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => { await tx.delete(invitations).where(eq(invitations.id, id)); revalidatePath('/settings'); return { ok: true as const, data: null }; });
}
export async function changeRole(userId: string, role: 'admin' | 'agent' | 'viewer'): Promise<Result> {
  const g = await guard('owner'); if ('error' in g) return fail(g.error);
  if (userId === g.ctx.user.id) return fail('You cannot change your own role.');
  return db(g.ctx, async (tx) => {
    const r = await tx.update(tenantMembers).set({ role, updatedAt: new Date() }).where(and(eq(tenantMembers.tenantId, g.ctx.tenantId), eq(tenantMembers.userId, userId), sql`${tenantMembers.role} <> 'owner'`)).returning({ u: tenantMembers.userId });
    if (!r.length) return fail('That member could not be changed.');
    await audit(tx, 'member.role_changed', 'member', userId, { role });
    revalidatePath('/settings');
    return { ok: true as const, data: null };
  });
}
export async function removeMember(userId: string): Promise<Result> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  if (userId === g.ctx.user.id) return fail('You cannot remove yourself.');
  return db(g.ctx, async (tx) => {
    const [t] = await tx.select({ role: tenantMembers.role }).from(tenantMembers).where(and(eq(tenantMembers.tenantId, g.ctx.tenantId), eq(tenantMembers.userId, userId)));
    if (!t) return fail('Member not found.');
    if (t.role === 'owner') return fail('The owner cannot be removed.');
    if (t.role === 'admin' && g.ctx.role !== 'owner') return fail('Only the owner can remove an admin.');
    await tx.delete(tenantMembers).where(and(eq(tenantMembers.tenantId, g.ctx.tenantId), eq(tenantMembers.userId, userId)));
    await audit(tx, 'member.removed', 'member', userId);
    revalidatePath('/settings');
    return { ok: true as const, data: null };
  });
}

const profile = z.object({ name: z.string().trim().min(2, 'Enter the business name.').max(80), legalName: z.string().trim().max(120).optional(), gstin: z.string().trim().toUpperCase().regex(/^$|^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'That GSTIN does not look right. It has 15 characters, for example 27AAYPA2701N1ZG.').optional() });
export async function saveProfile(input: z.input<typeof profile>): Promise<Result> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  const p = profile.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the fields.');
  return db(g.ctx, async (tx) => {
    await tx.update(tenants).set({ name: p.data.name, legalName: p.data.legalName || null, gstin: p.data.gstin || null, updatedAt: new Date() }).where(eq(tenants.id, g.ctx.tenantId));
    await audit(tx, 'workspace.updated', 'tenant', g.ctx.tenantId);
    revalidatePath('/', 'layout');
    return { ok: true as const, data: null };
  });
}
export async function loadProfile() {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => { const [t] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId)); return { name: t!.name, legalName: t!.legalName ?? '', gstin: t!.gstin ?? '', vertical: t!.vertical, review: t!.verticalReviewStatus, plan: t!.planId, status: t!.status }; });
}

/** Accepting an invite: runs the SECURITY DEFINER function, which verifies token, expiry and that the invite was sent to this user's email. */
export async function acceptInvite(token: string): Promise<Result<{ tenantId: string }>> {
  const s = await getSession();
  if (!s) return fail('Log in or create an account with the invited email first.');
  try {
    const id = await appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${s.user.id}, true)`);
      const r = await tx.execute(sql`select public.accept_invitation(${s.user.id}, ${hash(token)}) as id`);
      return (r as unknown as { id: string }[])[0]!.id;
    });
    (await cookies()).set(WORKSPACE_COOKIE, id, { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 24 * 365 });
    return { ok: true as const, data: { tenantId: id } };
  } catch (e) {
    const m = String((e as Error).message ?? e);
    if (m.includes('invitation_expired')) return fail('This invitation has expired. Ask for a new one.');
    if (m.includes('invitation_used')) return fail('This invitation was already used.');
    if (m.includes('invitation_wrong_email')) return fail(`This invitation was sent to a different email than ${s.user.email}. Log in with the invited email.`);
    return fail('This invitation link is not valid.');
  }
}


export interface QuietSettings { enabled: boolean; startHour: number; endHour: number; timezone: string }
export async function loadQuiet(): Promise<QuietSettings> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => { const [t] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId)); return { enabled: t!.quietHoursEnabled, startHour: t!.quietStartHour, endHour: t!.quietEndHour, timezone: t!.timezone }; });
}
/** Quiet hours hold promotional messages only; replies and updates are never delayed. Owner or admin. */
export async function saveQuiet(input: { enabled: boolean; startHour: number; endHour: number }): Promise<Result> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => {
    const [t] = await tx.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, g.ctx.tenantId));
    const problem = checkQuietHours({ enabled: !!input.enabled, startHour: Number(input.startHour), endHour: Number(input.endHour), timezone: t?.tz ?? 'Asia/Kolkata' });
    if (problem) return fail(problem);
    await tx.update(tenants).set({ quietHoursEnabled: !!input.enabled, quietStartHour: Number(input.startHour), quietEndHour: Number(input.endHour), updatedAt: new Date() }).where(eq(tenants.id, g.ctx.tenantId));
    await audit(tx, 'workspace.quiet_hours', 'tenant', g.ctx.tenantId, { enabled: !!input.enabled, start: Number(input.startHour), end: Number(input.endHour) });
    revalidatePath('/settings');
    return { ok: true as const, data: null };
  });
}
