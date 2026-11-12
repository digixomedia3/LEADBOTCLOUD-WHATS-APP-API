'use server';

import { revalidatePath } from 'next/cache';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { automationRules } from '@lbc/db';
import { Forbidden, assertRole, db, requireCtx, type Ctx } from '@/lib/session';

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
async function guard(): Promise<{ ctx: Ctx } | { error: string }> {
  const ctx = await requireCtx();
  try { assertRole(ctx, 'admin'); } catch (e) { if (e instanceof Forbidden) return { error: 'Your role cannot do this. Ask the workspace owner.' }; throw e; }
  return { ctx };
}

export interface RuleRow { id: string; name: string; kind: string; keywords: string[]; reply: string; active: boolean; hits: number }
export async function listRules(): Promise<RuleRow[]> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => (await tx.select().from(automationRules).orderBy(desc(automationRules.createdAt))).map((r) => ({ id: r.id, name: r.name, kind: r.kind, keywords: r.keywords, reply: r.reply, active: r.active, hits: r.hits })));
}

const schema = z.object({
  name: z.string().trim().min(2, 'Give the rule a name.').max(80),
  kind: z.enum(['keyword', 'welcome', 'away']),
  keywords: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  reply: z.string().trim().min(1, 'Write the reply.').max(1000),
});

export async function saveRule(input: z.input<typeof schema> & { id?: string }): Promise<Result> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  const p = schema.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the fields.');
  if (p.data.kind === 'keyword' && p.data.keywords.length === 0) return fail('Add at least one keyword that triggers this reply.');
  return db(g.ctx, async (tx) => {
    const limit = g.ctx.workspace.plan === 'free' ? 3 : 1000;
    if (!input.id) {
      const have = await tx.select({ id: automationRules.id }).from(automationRules);
      if (have.length >= limit) return fail(`The Free plan allows ${limit} auto-reply rules. Upgrade for more.`);
      await tx.insert(automationRules).values({ tenantId: g.ctx.tenantId, ...p.data });
    } else await tx.update(automationRules).set(p.data).where(eq(automationRules.id, input.id));
    revalidatePath('/automation');
    return { ok: true as const, data: null };
  });
}
export async function toggleRule(id: string, active: boolean): Promise<Result> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => { await tx.update(automationRules).set({ active }).where(eq(automationRules.id, id)); revalidatePath('/automation'); return { ok: true as const, data: null }; });
}
export async function deleteRule(id: string): Promise<Result> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => { await tx.delete(automationRules).where(eq(automationRules.id, id)); revalidatePath('/automation'); return { ok: true as const, data: null }; });
}
