'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';

export interface PublicFormConfig {
  title: string; intro: string | null; buttonText: string; thankYou: string; askEmail: boolean;
  extraFields: { key: string; label: string; required?: boolean }[]; consentText: string | null; accent: string; business: string;
}

/** The page a customer sees. Plain, fast, readable on a phone in sunlight; the owner's colour is used for the button only. */
export function PublicForm({ config: c, action }: { config: PublicFormConfig; action: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('');
    const fd = new FormData(e.currentTarget);
    const body: Record<string, string> = {};
    fd.forEach((v, k) => { if (typeof v === 'string') body[k] = v; });
    // Page address and campaign tags travel with the lead so the owner can see which ad or post it came from.
    const q = new URLSearchParams(window.location.search);
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid']) { const v = q.get(k); if (v) body[k] = v; }
    body.page_url = window.location.origin + window.location.pathname;
    if (!body.whatsapp_consent) delete body.whatsapp_consent;
    setState('sending');
    try {
      const r = await fetch(action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (r.ok && j.ok) { setState('done'); return; }
      setError(r.status === 429 ? 'Too many tries. Please wait a minute and try again.' : j.error ?? 'Something went wrong. Please try again.'); setState('idle');
    } catch { setError('We could not reach the server. Check your internet and try again.'); setState('idle'); }
  }

  const field = 'w-full min-h-12 rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30';
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 p-4" style={{ ['--accent' as string]: c.accent }}>
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{c.business}</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">{c.title}</h1>
        {c.intro ? <p className="mt-2 text-sm text-slate-600">{c.intro}</p> : null}
        {state === 'done' ? (
          <div className="mt-6 flex flex-col items-center gap-3 py-6 text-center" role="status">
            <CheckCircle2 className="size-12" style={{ color: c.accent }} />
            <p className="text-lg font-semibold text-slate-900">{c.thankYou}</p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3" noValidate={false}>
            <label className="text-sm font-medium text-slate-700">Your name<input name="name" required maxLength={120} autoComplete="name" className={`${field} mt-1`} /></label>
            <label className="text-sm font-medium text-slate-700">WhatsApp number<input name="phone" required inputMode="tel" autoComplete="tel" placeholder="98765 43210" maxLength={20} className={`${field} mt-1`} /></label>
            {c.askEmail ? <label className="text-sm font-medium text-slate-700">Email<input name="email" type="email" maxLength={254} autoComplete="email" className={`${field} mt-1`} /></label> : null}
            {c.extraFields.map((x) => <label key={x.key} className="text-sm font-medium text-slate-700">{x.label}<input name={x.key} required={!!x.required} maxLength={300} className={`${field} mt-1`} /></label>)}
            {/* Bot trap: invisible and unreachable for people, tempting for scripts. */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
            {c.consentText ? (
              <label className="flex items-start gap-3 text-sm text-slate-700"><input type="checkbox" name="whatsapp_consent" value="yes" className="mt-1 size-5 shrink-0" style={{ accentColor: c.accent }} /><span>{c.consentText}</span></label>
            ) : null}
            {error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}
            <button type="submit" disabled={state === 'sending'} className="mt-1 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-base font-bold text-white disabled:opacity-60" style={{ background: c.accent }}>
              {state === 'sending' ? <Loader2 className="size-5 animate-spin" /> : null}{c.buttonText}
            </button>
            <p className="text-center text-xs text-slate-400">Your details go to {c.business} only.</p>
          </form>
        )}
      </div>
    </main>
  );
}
