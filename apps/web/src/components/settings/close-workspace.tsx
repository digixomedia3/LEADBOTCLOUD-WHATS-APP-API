'use client';

import { useEffect, useState, useTransition } from 'react';
import { Download, Loader2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cancelWorkspaceClosure, loadWorkspaceClosure, requestWorkspaceClosure } from '@/app/(app)/settings/actions';
import type { ClosureInfo } from '@/lib/core/closure';

/** The last card on the Business tab. Owner only: closing is slow on purpose (30 days to change your mind) and asks for the workspace name. */
/** A file download from an API route, not a page: next/link would try to render it, so a plain link with `download` is the right element. */
function ExportLink({ children }: { children: React.ReactNode }) {
  return <a href="/api/workspace-export" download className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold hover:bg-ink/5"><Download className="size-4" />{children}</a>;
}

export function CloseWorkspace() {
  const [info, setInfo] = useState<ClosureInfo | null>(null);
  const [typed, setTyped] = useState(''); const [open, setOpen] = useState(false);
  const [err, setErr] = useState(''); const [pending, start] = useTransition();
  const load = () => loadWorkspaceClosure().then(setInfo);
  useEffect(() => { void load(); }, []);
  if (!info) return null;
  const date = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const request = () => start(async () => { setErr(''); const r = await requestWorkspaceClosure(typed); if (!r.ok) { setErr(r.error); return; } setOpen(false); setTyped(''); await load(); });
  const cancel = () => start(async () => { setErr(''); const r = await cancelWorkspaceClosure(); if (!r.ok) { setErr(r.error); return; } await load(); });

  return (
    <section className="card flex max-w-2xl flex-col gap-3 border-rose/30 p-5" aria-label="Close workspace">
      <h2 className="flex items-center gap-2 text-lg font-bold"><TriangleAlert className="size-5 text-rose" />Close this workspace</h2>
      {info.requestedAt && info.dueAt ? (
        <>
          <p role="status" className="rounded-xl bg-amber/10 p-3 text-sm"><strong>Closing on {date(info.dueAt)}</strong> ({info.daysLeft} day{info.daysLeft === 1 ? '' : 's'} left). Until then everything still works and you can change your mind. After that, your contacts, chats, templates, files and WhatsApp connection are erased for good.</p>
          <div className="flex flex-wrap gap-2">
            <ExportLink>Download everything first</ExportLink>
            <Button variant="outline" disabled={pending} onClick={cancel}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}Keep my workspace</Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">Closing erases your contacts, chats, messages, files, templates, campaigns and WhatsApp connection, and removes the team&apos;s sign-ins. We keep only your invoices and a record that you closed it, as the law requires. You get 30 days to change your mind.</p>
          <div className="flex flex-wrap gap-2">
            <ExportLink>Download everything</ExportLink>
            {!open ? <Button variant="outline" onClick={() => setOpen(true)}>Close workspace…</Button> : null}
          </div>
          {open ? (
            <div className="flex flex-col gap-2 rounded-xl border border-rose/30 p-3">
              <label htmlFor="close-confirm" className="text-sm font-semibold">Type <span className="font-mono">{info.workspaceName}</span> to confirm</label>
              <input id="close-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="h-11 rounded-lg border border-line bg-card px-3" />
              <div className="flex flex-wrap gap-2">
                <Button disabled={pending || typed.trim().toLowerCase() !== info.workspaceName.trim().toLowerCase()} onClick={request}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}Start the 30 days</Button>
                <Button variant="outline" onClick={() => { setOpen(false); setTyped(''); setErr(''); }}>Never mind</Button>
              </div>
            </div>) : null}
        </>)}
      {err ? <p role="alert" className="text-sm text-rose">{err}</p> : null}
    </section>
  );
}
