'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';

/** Asks for a reset link. The answer is the same whether or not the address has an account, so the form can not be used to look up customers. */
export function ForgotForm() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get('email') ?? '').trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { setError('Enter the email address you signed up with.'); return; }
    setBusy(true); setError('');
    const { error: err } = await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' });
    setBusy(false);
    if (err?.status === 429) { setError('Too many requests. Wait a few minutes and try again.'); return; }
    setSent(email); // shown for success AND for unknown addresses
  }

  if (sent) {
    return (
      <div role="status" className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-2xl border border-brand/40 bg-brand/10 p-4 text-sm"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand" /><div><p className="font-semibold">Check your email</p><p className="mt-1 text-muted">If <strong className="text-ink">{sent}</strong> has a LeadBotCloud account, we have sent a link to choose a new password. It works for 1 hour. Look in spam too.</p></div></div>
        <button type="button" onClick={() => setSent('')} className="text-sm font-semibold text-brand">Use a different email</button>
        <Link href="/login" className="text-center text-sm font-semibold text-brand">Back to log in</Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <FormError>{error}</FormError>
      <Field label="Email"><Input name="email" type="email" autoComplete="email" required autoFocus placeholder="you@business.com" /></Field>
      <Button type="submit" disabled={busy} className="mt-1 w-full">{busy ? <Loader2 className="size-4 animate-spin" /> : null}Send me a link</Button>
      <Link href="/login" className="text-center text-sm font-semibold text-brand">Back to log in</Link>
    </form>
  );
}

/** Sets the new password from the emailed link. The token comes from the URL and is checked by the server. */
export function ResetForm({ token, invalid }: { token: string | null; invalid: boolean }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  if (done) {
    return (
      <div role="status" className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-2xl border border-brand/40 bg-brand/10 p-4 text-sm"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand" /><div><p className="font-semibold">Password changed</p><p className="mt-1 text-muted">You were signed out everywhere. Log in with your new password.</p></div></div>
        <Link href="/login" className="grad-bg inline-flex min-h-11 items-center justify-center rounded-full px-5 text-sm font-semibold text-white">Log in</Link>
      </div>
    );
  }
  if (!token || invalid) {
    return (
      <div className="flex flex-col gap-4">
        <FormError>This link is not valid any more. Links work once and for 1 hour.</FormError>
        <Link href="/forgot-password" className="grad-bg inline-flex min-h-11 items-center justify-center rounded-full px-5 text-sm font-semibold text-white">Get a new link</Link>
      </div>
    );
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const a = String(f.get('password') ?? ''), b = String(f.get('confirm') ?? '');
    if (a.length < 8) { setError('Use at least 8 characters.'); return; }
    if (a !== b) { setError('The two passwords are not the same.'); return; }
    setBusy(true); setError('');
    const { error: err } = await authClient.resetPassword({ newPassword: a, token: token! });
    setBusy(false);
    if (err) { setError(err.status === 429 ? 'Too many tries. Wait a few minutes.' : 'This link has expired or was already used. Ask for a new one.'); return; }
    setDone(true);
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <FormError>{error}</FormError>
      <Field label="New password"><Input name="password" type="password" autoComplete="new-password" required minLength={8} autoFocus /></Field>
      <Field label="Type it again"><Input name="confirm" type="password" autoComplete="new-password" required minLength={8} /></Field>
      <Button type="submit" disabled={busy} className="mt-1 w-full">{busy ? <Loader2 className="size-4 animate-spin" /> : null}Change password</Button>
    </form>
  );
}
