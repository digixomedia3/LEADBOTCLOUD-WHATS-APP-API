import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthFrame } from '@/components/auth/auth-frame';
import { VerifyForm } from '@/components/auth/verify-form';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Confirm it is you', robots: { index: false, follow: false } };

export default async function VerifyPage() {
  if (await getSession()) redirect('/dashboard');
  return (
    <AuthFrame title="One more step" subtitle="Enter the code from your authenticator app.">
      <VerifyForm />
    </AuthFrame>
  );
}
