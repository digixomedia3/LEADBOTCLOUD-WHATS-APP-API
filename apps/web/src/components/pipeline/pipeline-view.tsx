'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { updateLead } from '@/app/(app)/leads/actions';
import { loadPipeline, type Card } from '@/app/(app)/pipeline/actions';
import { formatPhone } from '@lbc/shared';
import { cn } from '@/lib/utils';

const COLS = [['new', 'New', 'bg-indigo'], ['contacted', 'Contacted', 'bg-cyan-500'], ['qualified', 'Qualified', 'bg-amber'], ['won', 'Won', 'bg-brand'], ['lost', 'Lost', 'bg-rose']] as const;
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export function PipelineView({ initial, truncated: t0, canWrite }: { initial: Card[]; truncated: boolean; canWrite: boolean }) {
  const [cards, setCards] = useState(initial);
  const [truncated, setTruncated] = useState(t0);
  const [mine, setMine] = useState(false);
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const reload = async (m = mine) => { const r = await loadPipeline(m); setCards(r.cards); setTruncated(r.truncated); };
  const move = (c: Card, to: string) => start(async () => {
    setErr('');
    const r = await updateLead(c.id, { status: to as 'new' });
    if (!r.ok) setErr(r.error);
    await reload();
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-2xl font-extrabold">Pipeline</h2><p className="text-sm text-muted">Every open enquiry by stage. Move a card with the arrows. <Link href="/leads" className="font-semibold text-brand">Open the full lead list</Link></p></div>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" className="size-5" checked={mine} onChange={(e) => { setMine(e.target.checked); start(() => reload(e.target.checked)); }} />Only my leads</label>
      </div>
      {err ? <p role="alert" className="rounded-xl bg-rose/10 p-3 text-sm text-rose">{err}</p> : null}
      {truncated ? <p className="text-xs text-muted">Showing the 300 most recently updated leads.</p> : null}
      <div className={cn('-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0', pending && 'opacity-70')}>
        {COLS.map(([key, label, dot], ci) => {
          const list = cards.filter((c) => c.status === key);
          const total = list.reduce((s, c) => s + c.valueRupees, 0);
          return (
            <section key={key} aria-label={label} className="w-72 shrink-0 snap-start rounded-2xl bg-card2 p-3 xl:w-auto xl:min-w-0 xl:flex-1">
              <header className="mb-3 flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-semibold"><span className={cn('size-2.5 rounded-full', dot)} />{label}<span className="text-sm font-normal text-muted">{list.length}</span></h3>{total > 0 ? <span className="text-xs font-semibold text-muted">{inr(total)}</span> : null}</header>
              <ul className="flex flex-col gap-2">
                {list.map((c) => (
                  <li key={c.id} className="card p-3">
                    <p className="truncate font-medium">{c.name ?? 'No name'}</p>
                    <p className="text-xs text-muted">{formatPhone(c.phone)}</p>
                    <p className="mt-1 truncate text-xs text-muted">{[c.source, c.owner ? `Owner: ${c.owner}` : 'Unassigned', c.valueRupees > 0 ? inr(c.valueRupees) : null].filter(Boolean).join(' · ')}</p>
                    {canWrite ? (
                      <div className="mt-2 flex items-center justify-between gap-1">
                        <Button size="sm" variant="ghost" disabled={pending || ci === 0} onClick={() => move(c, COLS[ci - 1]![0])} aria-label={`Move ${c.name ?? 'lead'} to ${COLS[ci - 1]?.[1] ?? ''}`}><ChevronLeft className="size-4" /></Button>
                        <span className="text-[11px] text-muted">{new Date(c.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}</span>
                        <Button size="sm" variant="ghost" disabled={pending || ci === COLS.length - 1} onClick={() => move(c, COLS[ci + 1]![0])} aria-label={`Move ${c.name ?? 'lead'} to ${COLS[ci + 1]?.[1] ?? ''}`}><ChevronRight className="size-4" /></Button>
                      </div>
                    ) : null}
                  </li>
                ))}
                {list.length === 0 ? <li className="rounded-xl border border-dashed border-line p-4 text-center text-xs text-muted">Empty</li> : null}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
