'use server';

import { revalidatePath } from 'next/cache';
import { Forbidden, assertRole, requireCtx, type Ctx } from '@/lib/session';
import { addTestNumber, listTestNumbers, removeTestNumber, sendTestFor, type TestNumber, type TestSendInput } from '@/lib/core/test-send';

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

async function guard(): Promise<{ ctx: Ctx } | { error: string }> {
  const ctx = await requireCtx();
  try { assertRole(ctx, 'admin'); } catch (e) {
    if (e instanceof Forbidden) return { error: 'Your role cannot do this. Ask the workspace owner.' };
    throw e;
  }
  return { ctx };
}

export async function loadTestNumbers(): Promise<Result<TestNumber[]>> {
  const g = await guard(); if ('error' in g) return { ok: false, error: g.error };
  return { ok: true, data: await listTestNumbers(g.ctx) };
}
export async function saveTestNumber(phone: string, label: string): Promise<Result<TestNumber>> {
  const g = await guard(); if ('error' in g) return { ok: false, error: g.error };
  const r = await addTestNumber(g.ctx, phone, label); revalidatePath('/campaigns'); return r;
}
export async function deleteTestNumber(id: string): Promise<Result> {
  const g = await guard(); if ('error' in g) return { ok: false, error: g.error };
  const r = await removeTestNumber(g.ctx, id); revalidatePath('/campaigns'); return r;
}
export async function sendTest(input: TestSendInput): Promise<Result<{ sent: number; remainingThisHour: number }>> {
  const g = await guard(); if ('error' in g) return { ok: false, error: g.error };
  return sendTestFor(g.ctx, input);
}
