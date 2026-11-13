'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, Bell, CheckCircle2, Info, OctagonAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getHeaderState, type HeaderState, type Severity } from '@/app/(app)/header-actions';

const TONE: Record<HeaderState['pill']['tone'], string> = { ok: 'bg-brand', warn: 'bg-amber', bad: 'bg-rose', off: 'bg-muted' };
const SEV: Record<Severity, { Icon: typeof Info; cls: string }> = {
  critical: { Icon: OctagonAlert, cls: 'text-rose' },
  warning: { Icon: AlertTriangle, cls: 'text-amber' },
  info: { Icon: Info, cls: 'text-indigo' },
};

/** The connection pill and the notification bell, both from live workspace data. Refreshes on navigation, on open, and every minute. */
export function HeaderStatus() {
  const path = usePathname();
  const [s, setS] = useState<HeaderState | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const load = useCallback(() => { void getHeaderState().then(setS).catch(() => undefined); }, []);

  useEffect(() => { load(); }, [path, load]);
  useEffect(() => { const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
  // Screens that change the connection (connect, disconnect) ask the header to refresh at once.
  useEffect(() => { window.addEventListener('lbc:status-changed', load); return () => window.removeEventListener('lbc:status-changed', load); }, [load]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const important = s?.alerts.filter((a) => a.severity !== 'info').length ?? 0;
  const total = s?.alerts.length ?? 0;

  return (
    <>
      {s ? <Link href="/settings" className="hidden items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-xs font-semibold lg:flex"><span className={cn('size-2 rounded-full', TONE[s.pill.tone], s.pill.tone === 'ok' && 'live-dot')} />{s.pill.label}</Link> : null}
      <span ref={box} className="relative">
        <button aria-label={total ? `Notifications, ${total} new` : 'Notifications'} aria-expanded={open} onClick={() => { setOpen((o) => !o); load(); }} className="relative flex size-11 items-center justify-center rounded-xl hover:bg-ink/5">
          <Bell className="size-5" />
          {total ? <span className={cn('absolute right-2 top-2 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-4 text-white', important ? 'bg-rose' : 'bg-indigo')}>{total > 9 ? '9+' : total}</span> : null}
        </button>
        {open ? (
          <div role="dialog" aria-label="Notifications" className="card absolute right-0 top-12 z-50 w-[min(92vw,24rem)] overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3"><p className="font-display font-bold">Notifications</p><span className="text-xs text-muted">{total ? `${total} to look at` : 'All clear'}</span></div>
            {total === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center"><CheckCircle2 className="size-7 text-brand" /><p className="text-sm font-semibold">Nothing needs your attention</p><p className="text-xs text-muted">Problems with your number, paused sends and waiting customers show up here.</p></div>
            ) : (
              <ul className="max-h-[26rem] divide-y divide-line overflow-y-auto">
                {s!.alerts.map((a) => {
                  const { Icon, cls } = SEV[a.severity];
                  return (
                    <li key={a.id}>
                      <Link href={a.href} onClick={() => setOpen(false)} className="flex gap-3 px-4 py-3 hover:bg-ink/5">
                        <Icon className={cn('mt-0.5 size-5 shrink-0', cls)} />
                        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{a.title}</span><span className="mt-0.5 block text-xs text-muted">{a.detail}</span></span>
                        <span className="self-center text-xs font-semibold text-brand">{a.action}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}
      </span>
    </>
  );
}
