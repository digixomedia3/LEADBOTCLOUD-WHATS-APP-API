import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthFrame } from '@/components/auth/auth-frame';
import { OnboardingForm } from '@/components/auth/onboarding-form';
import { getSession, listMemberships } from '@/lib/session';
import { safeNext } from '@/lib/safe-next';

export const metadata: Metadata = { title: 'Set up your workspace' };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const s = await getSession();
  if (!s) redirect('/login');
  const next = safeNext((await searchParams).next, '');
  if (next.startsWith('/invite/')) redirect(next);
  if ((await listMemberships(s.user.id)).length > 0) redirect('/dashboard');
  return (
    <AuthFrame title="One last step" subtitle={`Hi ${s.user.name.split(' ')[0]}, tell us about your business.`}>
      <OnboardingForm />
    </AuthFrame>
  );
}
