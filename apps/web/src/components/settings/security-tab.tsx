'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Loader2, ShieldCheck, ShieldOff } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { loadSecurity, qrForSetup, type SecurityInfo } from '@/app/(app)/settings/security-actions';

type Step = 'idle' | 'password' | 'scan' | 'codes' | 'disable';

/**
 * Turn the authenticator app on or off for the signed-in person. Anyone may; platform staff must before they can use /admin.
 * The secret is drawn as a QR code on OUR server (never sent to an outside QR service) and shown as text as well, for people who cannot scan.
 */
export function SecurityTab() {
  const [info, setInfo] = useState<SecurityInfo | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [uri, setUri] = useState(''); const [qr, setQr] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [copied, setCopied] = useState(false); const [saved, setSaved] = useState(false);
  useEffect(() => { void loadSecurity().then(setInfo); }, []);
  const refresh = async () => setInfo(await loadSecurity());
  const reset = () => { setStep('idle'); setPassword(''); setCode(''); setUri(''); setQr(''); setCodes([]); setError(''); setSaved(false); setCopied(false); };
  const secret = (() => { try { return new URL(uri).searchParams.get('secret') ?? ''; } catch { return ''; } })();

  async function begin() {
    setBusy(true); setError('');
    const { data, error: err } = await authClient.twoFactor.enable({ password });
    if (err || !data || data.method !== 'totp') { setBusy(false); setError(err?.status === 429 ? 'Too many tries. Wait a minute.' : 'That password is not right.'); return; }
    const q = await qrForSetup(data.totpURI);
    setBusy(false); setUri(data.totpURI); setQr(q.ok ? q.svg : ''); setCodes(data.backupCodes); setPassword(''); setStep('scan');
  }
  async function confirm() {
    setBusy(true); setError('');
    const { error: err } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, '') });
    setBusy(false);
    if (err) { setError(err.status === 429 ? 'Too many tries. Wait a minute.' : 'That code is not right. Check the time on your phone and use the newest code.'); return; }
    setCode(''); setStep('codes'); await refresh();
  }
  async function turnOff() {
    setBusy(true); setError('');
    const { error: err } = await authClient.twoFactor.disable({ password });
    setBusy(false);
    if (err) { setError('That password is not right.'); return; }
    reset(); await refresh();
  }
  async function newCodes() {
    setBusy(true); setError('');
    const { data, error: err } = await authClient.twoFactor.generateBackupCodes({ password });
    setBusy(false);
    if (err || !data) { setError('That password is not right.'); return; }
    setCodes(data.backupCodes); setPassword(''); setStep('codes'); setSaved(false);
  }

  if (!info) return <div className="card p-5 text-sm text-muted">Loading…</div>;
  return (
    <div className="flex flex-col gap-5">
      <section className="card flex flex-col gap-4 p-5" aria-label="Two-step sign-in">
        <div className="flex items-start gap-3">
          {info.enabled ? <ShieldCheck className="mt-0.5 size-6 shrink-0 text-brand" aria-hidden /> : <ShieldOff className="mt-0.5 size-6 shrink-0 text-muted" aria-hidden />}
          <div className="min-w-0">
            <h3 className="font-display text-lg font-bold">Two-step sign-in {info.enabled ? <span className="ml-1 rounded-full bg-brand/15 px-2 py-0.5 text-xs font-bold text-brand">On</span> : <span className="ml-1 rounded-full bg-ink/10 px-2 py-0.5 text-xs font-bold">Off</span>}</h3>
            <p className="text-sm text-muted">Signing in also asks for a 6-digit code from an authenticator app on your phone, so a stolen password alone is not enough.{info.staff ? ' You are platform staff: the admin pages stay closed until this is on.' : ''}</p>
          </div>
        </div>
        {info.staff && !info.enabled ? <p role="alert" className="rounded-xl bg-rose/10 p-3 text-sm text-rose">Turn this on to use the platform admin pages.</p> : null}

        {step === 'idle' ? (info.enabled ? (
          <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { reset(); setStep('disable'); }}>Turn off</Button><Button variant="outline" onClick={() => { reset(); setStep('password'); }}>Make new backup codes</Button></div>
        ) : <div><Button onClick={() => { reset(); setStep('password'); }}>Turn on</Button></div>) : null}

        {step === 'password' ? (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void (info.enabled ? newCodes() : begin()); }}>
            <FormError>{error}</FormError>
            <Field label="Your password" hint={info.enabled ? 'Making new codes makes the old ones stop working.' : 'We ask once more to be sure it is you.'}><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
            <div className="flex gap-2"><Button type="button" variant="outline" onClick={reset}>Cancel</Button><Button type="submit" disabled={busy || !password}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}Continue</Button></div>
          </form>) : null}

        {step === 'scan' ? (
          <div className="flex flex-col gap-3">
            <ol className="list-decimal pl-5 text-sm"><li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, Authy or similar).</li><li>Scan this picture, or type the key below.</li><li>Type the 6 digits the app shows, then press Turn on.</li></ol>
            {qr ? <div className="mx-auto w-48 rounded-xl bg-white p-2" role="img" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: qr }} /> : null}
            <p className="break-all text-center font-mono text-sm" aria-label="Setup key">{secret.match(/.{1,4}/g)?.join(' ')}</p>
            <FormError>{error}</FormError>
            <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void confirm(); }}>
              <Field label="6-digit code"><Input inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" required /></Field>
              <div className="flex gap-2"><Button type="button" variant="outline" onClick={reset}>Cancel</Button><Button type="submit" disabled={busy || code.replace(/\s/g, '').length < 6}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}Turn on</Button></div>
            </form>
          </div>) : null}

        {step === 'codes' ? (
          <div className="flex flex-col gap-3">
            <p className="rounded-xl bg-amber/10 p-3 text-sm text-amber"><strong>Save these backup codes now.</strong> They are shown only once. Each works one time if you lose your phone. Keep them somewhere safe, not on the same phone.</p>
            <ul className="grid grid-cols-2 gap-2 rounded-xl bg-card2 p-3 font-mono text-sm" aria-label="Backup codes">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
            <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={async () => { await navigator.clipboard?.writeText(codes.join('\n')); setCopied(true); }}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? 'Copied' : 'Copy codes'}</Button></div>
            <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-5 accent-[var(--brand)]" />I saved my backup codes.</label>
            <div><Button disabled={!saved} onClick={reset}>Done</Button></div>
          </div>) : null}

        {step === 'disable' ? (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void turnOff(); }}>
            <FormError>{error}</FormError>
            <p className="text-sm">Anyone with your password will be able to sign in again without a code.</p>
            <Field label="Your password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
            <div className="flex gap-2"><Button type="button" variant="outline" onClick={reset}>Keep it on</Button><Button type="submit" variant="outline" disabled={busy || !password} className={cn('border-rose text-rose', busy && 'opacity-70')}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}Turn off</Button></div>
          </form>) : null}
      </section>
    </div>
  );
}
