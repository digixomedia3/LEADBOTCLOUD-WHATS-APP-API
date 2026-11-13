'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { safeNext } from '@/lib/safe-next';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';

export function SignupForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get('password'));
    if (password.length < 8) { setError('Use at least 8 characters for your password.'); return; }
    setBusy(true); setError('');
    const { error } = await authClient.signUp.email({ name: String(f.get('name')).trim(), email: String(f.get('email')).trim(), password });
    setBusy(false);
    if (error) {
      setError(error.status === 429 ? 'Too many attempts. Wait a minute and try again.' : error.status === 422 || /exist/i.test(error.message ?? '') ? 'An account with this email already exists. Try logging in instead.' : 'We could not create your account. Please check the details and try again.');
      return;
    }
    router.push(next && safeNext(next, '') ? `/onboarding?next=${encodeURIComponent(next)}` : '/onboarding');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <FormError>{error}</FormError>
      <Field label="Your name"><Input name="name" autoComplete="name" required placeholder="Asha Verma" /></Field>
      <Field label="Work email"><Input name="email" type="email" autoComplete="email" required placeholder="you@business.com" /></Field>
      <Field label="Password" hint="At least 8 characters."><Input name="password" type="password" autoComplete="new-password" required minLength={8} /></Field>
      <Button type="submit" disabled={busy} className="mt-1 w-full">{busy ? <Loader2 className="size-4 animate-spin" /> : null}Create account</Button>
      <p className="text-center text-sm text-muted">Already have an account? <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="font-semibold text-brand">Log in</Link></p>
    </form>
  );
}
