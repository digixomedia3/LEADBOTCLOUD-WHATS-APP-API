import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthFrame } from '@/components/auth/auth-frame';
import { ForgotForm } from '@/components/auth/reset-forms';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Forgot password' };

export default async function ForgotPage() {
  if (await getSession()) redirect('/dashboard');
  return (
    <AuthFrame title="Forgot your password?" subtitle="Enter your email and we will send you a link to choose a new one.">
      <ForgotForm />
    </AuthFrame>
  );
}
