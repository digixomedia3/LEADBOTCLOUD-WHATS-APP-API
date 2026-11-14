'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, renewals } from '@lbc/db';
import { Forbidden, assertRole, db, requireCtx, type Ctx, audit } from '@/lib/session';

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
async function guard(): Promise<{ ctx: Ctx } | { error: string }> {
  const ctx = await requireCtx();
  try { assertRole(ctx, 'admin'); } catch (e) { if (e instanceof Forbidden) return { error: 'Your role cannot do this. Ask the workspace owner.' }; throw e; }
  return { ctx };
}

const todayIST = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export interface RenewalRow { id: string; contactId: string; name: string | null; phone: string; consent: string; planName: string; amountPaise: number; dueOn: string; status: string; bucket: 'overdue' | 'due_soon' | 'later' | 'renewed' | 'cancelled'; daysLeft: number; lastReminderAt: string | null }

export async function listRenewals(): Promise<{ rows: RenewalRow[]; kpi: { dueSoon: number; dueSoonPaise: number; overdue: number; overduePaise: number; recoveredPaise: number; renewedThisMonth: number } }> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => {
    const rs = await tx.select({ r: renewals, name: contacts.name, phone: contacts.phoneE164, consent: contacts.consentStatus }).from(renewals).innerJoin(contacts, eq(contacts.id, renewals.contactId)).orderBy(asc(renewals.dueOn)).limit(1000);
    const today = todayIST();
    const month = today.slice(0, 7);
    const rows: RenewalRow[] = rs.map(({ r, name, phone, consent }) => {
      const daysLeft = daysBetween(today, r.dueOn);
      const bucket = r.status === 'renewed' ? 'renewed' : r.status === 'cancelled' ? 'cancelled' : daysLeft < 0 ? 'overdue' : daysLeft <= 7 ? 'due_soon' : 'later';
      return { id: r.id, contactId: r.contactId, name, phone, consent, planName: r.planName, amountPaise: r.amountPaise, dueOn: r.dueOn, status: r.status, bucket, daysLeft, lastReminderAt: r.lastReminderAt?.toISOString() ?? null };
    });
    const sum = (b: string) => rows.filter((r) => r.bucket === b).reduce((s, r) => s + r.amountPaise, 0);
    const cnt = (b: string) => rows.filter((r) => r.bucket === b).length;
    const paidThisMonth = rs.filter(({ r }) => r.status === 'renewed' && r.paidAt && r.paidAt.toISOString().slice(0, 7) === month);
    return { rows, kpi: { dueSoon: cnt('due_soon'), dueSoonPaise: sum('due_soon'), overdue: cnt('overdue'), overduePaise: sum('overdue'), recoveredPaise: paidThisMonth.reduce((s, { r }) => s + r.amountPaise, 0), renewedThisMonth: paidThisMonth.length } };
  });
}

const schema = z.object({
  contactId: z.string().uuid('Choose a customer.'),
  planName: z.string().trim().min(2, 'Enter the plan name.').max(80),
  amountRupees: z.number({ message: 'Enter the amount.' }).min(0).max(10_000_000),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the due date.'),
});

export async function addRenewal(input: z.input<typeof schema>): Promise<Result> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  const p = schema.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the fields.');
  return db(g.ctx, async (tx) => {
    const [c] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, p.data.contactId));
    if (!c) return fail('Customer not found.');
    await tx.insert(renewals).values({ tenantId: g.ctx.tenantId, contactId: c.id, planName: p.data.planName, amountPaise: Math.round(p.data.amountRupees * 100), dueOn: p.data.dueOn });
    revalidatePath('/renewals');
    return { ok: true as const, data: null };
  });
}

export async function markPaid(id: string): Promise<Result> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => {
    const r = await tx.update(renewals).set({ status: 'renewed', paidAt: new Date() }).where(and(eq(renewals.id, id), eq(renewals.status, 'active'))).returning({ id: renewals.id });
    if (!r.length) return fail('Already updated.');
    await audit(tx, 'renewal.marked_paid', 'renewal', id);
    revalidatePath('/renewals');
    return { ok: true as const, data: null };
  });
}
export async function cancelRenewal(id: string): Promise<Result> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => { await tx.update(renewals).set({ status: 'cancelled' }).where(and(eq(renewals.id, id), eq(renewals.status, 'active'))); revalidatePath('/renewals'); return { ok: true as const, data: null }; });
}

/** Records that a reminder was queued. Sending needs an approved Promotional template and a connected number. */
export async function remindNow(id: string): Promise<Result> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => {
    const [r] = await tx.select({ r: renewals, consent: contacts.consentStatus }).from(renewals).innerJoin(contacts, eq(contacts.id, renewals.contactId)).where(eq(renewals.id, id));
    if (!r) return fail('Not found.');
    if (r.consent !== 'allowed') return fail('This customer has not agreed to messages, so no reminder can be sent.');
    const [t] = (await tx.execute(sql`select id from templates where category = 'marketing' and status = 'approved' limit 1`)) as unknown as { id: string }[];
    if (!t) return fail('You need an approved Promotional message format first. Create one in Templates (there is a Renewal reminder starter).');
    await tx.update(renewals).set({ lastReminderAt: new Date() }).where(eq(renewals.id, id));
    revalidatePath('/renewals');
    return { ok: true as const, data: null };
  });
}
