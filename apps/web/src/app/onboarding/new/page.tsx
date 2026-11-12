import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthFrame } from '@/components/auth/auth-frame';
import { OnboardingForm } from '@/components/auth/onboarding-form';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'New workspace' };

export default async function NewWorkspacePage() {
  const s = await getSession();
  if (!s) redirect('/login');
  return (
    <AuthFrame title="Create another workspace" subtitle="Each workspace has its own contacts, WhatsApp number and billing.">
      <OnboardingForm />
    </AuthFrame>
  );
}
