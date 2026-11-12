'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError('');
    const { error } = await authClient.signIn.email({ email: String(f.get('email')).trim(), password: String(f.get('password')) });
    setBusy(false);
    if (error) {
      setError(error.status === 429 ? 'Too many attempts. Wait a minute and try again.' : 'That email or password is not right. Check it and try again.');
      return;
    }
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <FormError>{error}</FormError>
      <Field label="Email"><Input name="email" type="email" autoComplete="email" required placeholder="you@business.com" /></Field>
      <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required minLength={8} /></Field>
      <Button type="submit" disabled={busy} className="mt-1 w-full">{busy ? <Loader2 className="size-4 animate-spin" /> : null}Log in</Button>
      <p className="text-center text-sm text-muted">New here? <Link href="/signup" className="font-semibold text-brand">Create your account</Link></p>
    </form>
  );
}
