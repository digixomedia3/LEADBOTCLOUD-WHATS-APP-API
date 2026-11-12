import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthFrame } from '@/components/auth/auth-frame';
import { SignupForm } from '@/components/auth/signup-form';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Create your account' };

export default async function SignupPage() {
  if (await getSession()) redirect('/dashboard');
  return (
    <AuthFrame title="Create your account" subtitle="Free to start. No card needed.">
      <SignupForm />
    </AuthFrame>
  );
}
