'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { BUSINESS_CATEGORIES, TERMS_VERSION, categoryRisk } from '@lbc/shared';
import { WORKSPACE_COOKIE, createWorkspaceFor, getSession, listMemberships } from '@/lib/session';

const schema = z.object({
  businessName: z.string().trim().min(2, 'Enter your business name.').max(100, 'That name is too long.'),
  category: z.string().refine((v) => BUSINESS_CATEGORIES.some((c) => c.value === v), 'Pick a business category.'),
  accept: z.literal('on', { errorMap: () => ({ message: 'Please accept the Terms and the Acceptable Use Policy to continue.' }) }),
});

export type OnboardingState = { error?: string };

export async function createWorkspaceAction(_prev: OnboardingState, form: FormData): Promise<OnboardingState> {
  const s = await getSession();
  if (!s) redirect('/login');

  const parsed = schema.safeParse({ businessName: form.get('businessName'), category: form.get('category'), accept: form.get('accept') });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };

  const risk = categoryRisk(parsed.data.category);
  if (risk === 'blocked') {
    return { error: 'Sorry, we cannot support this kind of business on WhatsApp. WhatsApp does not allow it, and we want to protect your number.' };
  }

  try {
    const id = await createWorkspaceFor(s.user.id, parsed.data.businessName, parsed.data.category, risk === 'review' ? 'flagged' : 'none', TERMS_VERSION);
    (await cookies()).set(WORKSPACE_COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 365 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('workspace limit')) return { error: 'You have reached the limit of 5 workspaces.' };
    return { error: 'We could not create your workspace. Please try again.' };
  }
  redirect('/dashboard');
}

export async function switchWorkspaceAction(tenantId: string) {
  const s = await getSession();
  if (!s) redirect('/login');
  const mine = await listMemberships(s.user.id);
  if (!mine.some((m) => m.tenantId === tenantId)) return; // not a member: ignore
  (await cookies()).set(WORKSPACE_COOKIE, tenantId, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 365 });
  redirect('/dashboard');
}
