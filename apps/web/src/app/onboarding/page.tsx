import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthFrame } from '@/components/auth/auth-frame';
import { OnboardingForm } from '@/components/auth/onboarding-form';
import { getSession, listMemberships } from '@/lib/session';

export const metadata: Metadata = { title: 'Set up your workspace' };

export default async function OnboardingPage() {
  const s = await getSession();
  if (!s) redirect('/login');
  if ((await listMemberships(s.user.id)).length > 0) redirect('/dashboard');
  return (
    <AuthFrame title="One last step" subtitle={`Hi ${s.user.name.split(' ')[0]}, tell us about your business.`}>
      <OnboardingForm />
    </AuthFrame>
  );
}
