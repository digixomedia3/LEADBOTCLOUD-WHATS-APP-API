'use client';

import { useState, useTransition } from 'react';
import { Eye } from 'lucide-react';
import { endView } from '@/app/(admin)/admin/actions';

/** Shown on every page while platform staff are looking at a customer's workspace. Cannot be missed, and ends the view in one click. */
export function ViewBanner({ tenantName, reason, expiresAt }: { tenantName: string; reason: string; expiresAt: string }) {
  const [busy, start] = useTransition(); const [err, setErr] = useState('');
  const mins = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 60000));
  return (
    <div role="status" className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/40 bg-amber-100 px-4 py-2 text-sm text-amber-950">
      <p className="min-w-0 break-words"><Eye className="mr-1.5 inline size-4" aria-hidden /><strong>Staff view of {tenantName}.</strong> Read-only: nothing can be changed or sent. About {mins} min left. Reason: {reason}</p>
      <div className="flex items-center gap-2">
        {err ? <span className="text-xs text-rose" role="alert">{err}</span> : null}
        <button type="button" disabled={busy} className="rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
          onClick={() => start(async () => { const r = await endView(); if (!r.ok) { setErr(r.error); return; } window.location.assign('/admin/workspaces'); })}>{busy ? 'Ending…' : 'End view'}</button>
      </div>
    </div>
  );
}
