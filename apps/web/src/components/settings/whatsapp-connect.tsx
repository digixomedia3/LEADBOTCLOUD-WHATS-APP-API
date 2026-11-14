'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CreditCard, ExternalLink, Loader2, MessageCircle, Plug, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { disconnect, finishConnect, getConnection, recordSessionInfo, startConnect, type ConnectionView } from '@/app/(app)/settings/connect-actions';

/* Minimal typing for the Facebook JS SDK pieces we use (spec 2.2 steps 2 to 4). */
interface FbLoginResponse { authResponse?: { code?: string } | null; status?: string }
interface Fb { init(o: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void; login(cb: (r: FbLoginResponse) => void, o: Record<string, unknown>): void }
declare global { interface Window { FB?: Fb; fbAsyncInit?: () => void } }

const QUALITY: Record<string, { label: string; cls: string }> = { GREEN: { label: 'High', cls: 'text-brand' }, YELLOW: { label: 'Medium', cls: 'text-amber' }, RED: { label: 'Low', cls: 'text-rose' } };
const TIERS: Record<string, string> = { TIER_50: '50 people a day', TIER_250: '250 people a day', TIER_1K: '1,000 people a day', TIER_2K: '2,000 people a day', TIER_10K: '10,000 people a day', TIER_100K: '100,000 people a day', TIER_UNLIMITED: 'No daily limit' };

function loadSdk(appId: string, version: string): Promise<Fb> {
  return new Promise((resolve, reject) => {
    if (window.FB) { resolve(window.FB); return; }
    window.fbAsyncInit = () => { window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version }); resolve(window.FB!); };
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/en_US/sdk.js'; s.async = true; s.defer = true; s.crossOrigin = 'anonymous';
    s.onerror = () => reject(new Error('Could not load the Meta sign-in. Check your internet connection or ad blocker, then try again.'));
    document.body.appendChild(s);
    setTimeout(() => { if (!window.FB) reject(new Error('The Meta sign-in took too long to load. Please try again.')); }, 15_000);
  });
}

export function WhatsAppConnect() {
  const [v, setV] = useState<ConnectionView | null>(null);
  const [busy, setBusy] = useState<'' | 'connecting' | 'finishing' | 'disconnecting'>('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState<{ display: string | null; warnings: string[] } | null>(null);
  const session = useRef<string>('');
  const finished = useRef(false);
  const reload = useCallback(async () => { setV(await getConnection()); window.dispatchEvent(new Event('lbc:status-changed')); }, []);
  useEffect(() => { void reload(); }, [reload]);

  // The Meta window reports what the owner did through window.postMessage. Accept it only from facebook.com (spec step 3).
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (!ev.origin.endsWith('facebook.com')) return;
      let msg: { type?: string; event?: string; data?: unknown };
      try { msg = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data; } catch { return; }
      if (!msg || msg.type !== 'WA_EMBEDDED_SIGNUP' || !session.current) return;
      const event = String(msg.event ?? '');
      void recordSessionInfo(session.current, event, msg.data);
      if (event === 'CANCEL') { setBusy(''); setError('You closed the Meta window before finishing. Nothing was connected.'); }
      if (event === 'ERROR') { setBusy(''); setError(`Meta reported a problem${(msg.data as { error_message?: string })?.error_message ? `: ${(msg.data as { error_message?: string }).error_message}` : ''}. Please try again.`); }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  async function connect() {
    if (!v?.sdk) return;
    setError(''); setOk(null); finished.current = false; setBusy('connecting');
    const s = await startConnect();
    if (!s.ok) { setError(s.error); setBusy(''); return; }
    session.current = s.data.sessionId;
    let fb: Fb;
    try { fb = await loadSdk(v.sdk.appId, v.sdk.version); } catch (e) { setError((e as Error).message); setBusy(''); return; }
    fb.login((resp) => {
      const code = resp.authResponse?.code;
      if (!code) { setBusy((b) => (b === 'connecting' ? '' : b)); return; } // closed or cancelled: the CANCEL message explains it
      if (finished.current) return;
      finished.current = true; setBusy('finishing');
      // Give the session-info message a moment to land first; it normally arrives before the callback.
      setTimeout(async () => {
        const r = await finishConnect(session.current, code);
        setBusy('');
        if (!r.ok) { setError(r.error); return; }
        setOk(r.data); await reload();
      }, 1200);
    }, { config_id: v.sdk.configId, response_type: 'code', override_default_response_type: true, extras: { setup: {} } });
  }

  async function off() {
    if (!confirm('Disconnect WhatsApp? Sending stops straight away and running campaigns pause. Your contacts, chats and templates stay.')) return;
    setBusy('disconnecting'); const r = await disconnect(); setBusy('');
    if (!r.ok) setError(r.error); else { setOk(null); await reload(); }
  }

  if (!v) return <div className="card flex items-center gap-3 p-5 text-sm text-muted"><Loader2 className="size-4 animate-spin" />Loading connection…</div>;
  const c = v.connection;
  const live = !!c && c.tokenStatus === 'valid';
  const q = c?.phone?.quality ? QUALITY[c.phone.quality] : undefined;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {ok ? (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-brand/40 bg-brand/10 p-4 text-sm"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand" /><div><p className="font-semibold">Connected{ok.display ? `: ${ok.display}` : ''}</p>{ok.warnings.map((w) => <p key={w} className="mt-1 text-muted">{w}</p>)}</div></div>
      ) : null}
      {error ? <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose/40 bg-rose/10 p-4 text-sm"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-rose" /><p>{error}</p></div> : null}

      {c ? (
        <div className="card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className={cn('flex size-11 items-center justify-center rounded-xl', live ? 'bg-brand/15 text-brand' : 'bg-rose/15 text-rose')}><Plug className="size-5" /></span>
            <div className="min-w-0 flex-1"><h3 className="font-display text-lg font-bold">{live ? 'WhatsApp is connected' : c.tokenStatus === 'revoked' ? 'WhatsApp is disconnected' : 'Reconnect needed'}</h3><p className="truncate text-sm text-muted">{c.phone?.verifiedName ?? 'Your business'}{c.phone?.display ? ` · ${c.phone.display}` : ''}</p></div>
            {v.canManage ? <Button variant="outline" size="sm" onClick={() => void reload()} aria-label="Refresh"><RefreshCw className="size-4" /></Button> : null}
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            {[
              ['Number status', c.phone?.status ?? '—'],
              ['Quality', q ? <span key="q" className={cn('font-semibold', q.cls)}>{q.label}</span> : 'Not rated yet'],
              ['Daily limit', c.phone?.tier ? (TIERS[c.phone.tier] ?? c.phone.tier) : 'Set by Meta as you send'],
              ['Display name', c.phone?.nameStatus ? c.phone.nameStatus.replace(/_/g, ' ').toLowerCase() : '—'],
              ['Promotional messages', c.mm === 'ONBOARDED' ? 'Ready' : c.mm ? c.mm.toLowerCase() : 'Using the standard route'],
              ['Message updates', c.subscribed === false ? 'Off, reconnect' : 'On'],
            ].map(([k, val]) => <div key={String(k)} className="rounded-xl bg-card2 px-3 py-2"><dt className="text-xs text-muted">{k}</dt><dd className="mt-0.5 font-semibold">{val}</dd></div>)}
          </dl>
          {c.phone?.onBizApp ? <p className="mt-3 text-xs text-muted">This number also works in the WhatsApp Business app.</p> : null}
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-line p-3 text-sm"><CreditCard className="mt-0.5 size-5 shrink-0 text-muted" /><div><p className="font-semibold">Meta bills you directly</p><p className="text-muted">Message charges go to the card in your Meta account, not to LeadBotCloud. Messages will not send until a payment method is added there.</p><a href="https://business.facebook.com/wa/manage/home/" target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-semibold text-brand">Open WhatsApp Manager <ExternalLink className="size-3.5" /></a></div></div>
          {v.canManage ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {!live && v.configured ? <Button onClick={() => void connect()} disabled={!!busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <MessageCircle className="size-4" />}Reconnect</Button> : null}
              {c.tokenStatus !== 'revoked' ? <Button variant="outline" onClick={() => void off()} disabled={!!busy}><Unplug className="size-4" />Disconnect</Button> : null}
            </div>
          ) : <p className="mt-4 text-xs text-muted">Only an owner or admin can change the connection.</p>}
        </div>
      ) : (
        <div className="card p-5">
          <div className="flex items-center gap-3"><span className="flex size-11 items-center justify-center rounded-xl bg-amber/15 text-amber"><Plug className="size-5" /></span><div><h3 className="font-display text-lg font-bold">Not connected</h3><p className="text-sm text-muted">Connect your own WhatsApp number to send for real. About 5 minutes.</p></div></div>
          <ol className="mt-5 space-y-3 text-sm">
            {[['Sign in with Facebook', 'Create or choose your Meta Business account. Meta guides you.'], ['Add and verify your number', 'Use a number that is not already on the WhatsApp app, or move it.'], ['Add a payment method in Meta', 'Meta bills message charges to your own card. We never touch the money.'], ['Allow every permission', 'We can only send and read replies if you allow all of them.']].map(([t, d], i) => (
              <li key={t} className="flex gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink/10 text-xs font-bold">{i + 1}</span><div><p className="font-semibold">{t}</p><p className="text-muted">{d}</p></div></li>
            ))}
          </ol>
          {v.configured && v.canManage ? (
            <Button className="mt-5 w-full sm:w-auto" onClick={() => void connect()} disabled={!!busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <MessageCircle className="size-4" />}{busy === 'finishing' ? 'Finishing…' : busy === 'connecting' ? 'Waiting for Meta…' : 'Connect WhatsApp'}</Button>
          ) : (
            <>
              <Button disabled className="mt-5 w-full sm:w-auto"><MessageCircle className="size-4" />Connect WhatsApp</Button>
              <p className="mt-3 text-xs text-muted">{v.canManage ? 'This button turns on once the DigiXoMedia Meta app details are added to this installation. Until then the panel runs in test mode, so you can set everything up now.' : 'Ask the workspace owner to connect WhatsApp.'}</p>
            </>
          )}
          <p className="mt-4 flex items-start gap-2 text-xs text-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0" />We store your connection encrypted and can never see it in plain form on the website side. You can disconnect any time here or in Meta.</p>
        </div>
      )}

      {v.lastAttempt?.error && !c ? <p className="text-xs text-muted">Last attempt: {v.lastAttempt.error}</p> : null}
    </div>
  );
}
