import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthFrame } from '@/components/auth/auth-frame';
import { LoginForm } from '@/components/auth/login-form';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Log in' };

export default async function LoginPage() {
  if (await getSession()) redirect('/dashboard');
  return (
    <AuthFrame title="Welcome back" subtitle="Log in to your LeadBotCloud workspace.">
      <LoginForm />
    </AuthFrame>
  );
}
