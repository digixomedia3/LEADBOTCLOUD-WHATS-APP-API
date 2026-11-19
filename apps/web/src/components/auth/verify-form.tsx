'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { safeNext } from '@/lib/safe-next';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';

/**
 * The second step of signing in, for people who turned on an authenticator app. A 6-digit code, or one of the ten backup codes if the phone is lost.
 * Never offers "trust this device": the code is asked every time, so a stolen password plus a borrowed laptop is still not enough.
 */
export function VerifyForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code') ?? '').replace(/[\s-]/g, '');
    if (!code) { setError(backup ? 'Enter one of your backup codes.' : 'Enter the 6 digits from your authenticator app.'); return; }
    setBusy(true); setError('');
    const { error: err } = backup ? await authClient.twoFactor.verifyBackupCode({ code }) : await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (err) {
      if (err.status === 429) setError('Too many tries. Wait a minute and try again.');
      else if (/lock/i.test(`${err.code ?? ''} ${err.message ?? ''}`)) setError('Too many wrong codes. This account is locked for 15 minutes.');
      else if (/cookie|expired|invalid.*(two|2)|session/i.test(`${err.code ?? ''} ${err.message ?? ''}`)) { router.push(`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`); return; }
      else setError(backup ? 'That backup code is not right, or it was already used.' : 'That code is not right. Check the time on your phone and try the newest code.');
      return;
    }
    router.push(safeNext(next, '/dashboard'));
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <FormError>{error}</FormError>
      <Field label={backup ? 'Backup code' : 'Code from your authenticator app'} hint={backup ? 'Each backup code works once.' : 'Six digits. It changes every 30 seconds.'}>
        <Input name="code" inputMode={backup ? 'text' : 'numeric'} autoComplete="one-time-code" autoFocus required maxLength={backup ? 24 : 7} placeholder={backup ? 'xxxxx-xxxxx' : '123456'} />
      </Field>
      <Button type="submit" disabled={busy} className="w-full">{busy ? <Loader2 className="size-4 animate-spin" /> : null}Continue</Button>
      <button type="button" className="text-sm font-semibold text-brand" onClick={() => { setBackup(!backup); setError(''); }}>{backup ? 'Use my authenticator app' : 'I lost my phone: use a backup code'}</button>
      <p className="text-center text-sm text-muted"><Link href="/login" className="font-semibold text-brand">Back to log in</Link></p>
    </form>
  );
}
