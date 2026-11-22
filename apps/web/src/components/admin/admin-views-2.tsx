'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Loader2, Search } from 'lucide-react';
import { inr } from '@lbc/shared';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';
import {
  addNote, cancelClosure, loadClosures, searchUsers, signOutUser,
  type AttentionRow, type ClosedRow, type ClosureRow, type Revenue, type StaffRow, type TenantExtra, type UserRow,
} from '@/app/(admin)/admin/actions';

const num = (n: number) => n.toLocaleString('en-IN');
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : 'Never');
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—');
const SEV: Record<string, string> = { high: 'bg-rose/15 text-rose', warn: 'bg-amber/15 text-amber', info: 'bg-indigo/15 text-indigo' };
const SEV_LABEL: Record<string, string> = { high: 'Act now', warn: 'Watch', info: 'FYI' };
const Banner = ({ m }: { m: { ok: boolean; text: string } | null }) => (m ? <p role={m.ok ? 'status' : 'alert'} className={cn('rounded-xl px-3 py-2 text-sm', m.ok ? 'bg-brand/10 text-brand' : 'bg-rose/10 text-rose')}>{m.text}</p> : null);

/** Meta's own meanings for the codes that show up most. Anything else is shown as the bare number. */
const ERROR_WORDS: Record<number, string> = {
  131026: 'Message could not be delivered (number not on WhatsApp, or blocked)', 131047: 'More than 24 hours since the customer last wrote', 131049: 'Meta chose not to deliver (healthy-ecosystem limit)',
  131048: 'Spam rate limit', 131056: 'Too many messages to one person', 130429: 'Sending too fast', 132000: 'Template fields do not match', 132001: 'Template does not exist', 133010: 'Number is not registered', 100: 'Invalid request',
};

/* ------------------------------------------------------------------ attention */
export function AttentionList({ rows }: { rows: AttentionRow[] }) {
  const [filter, setFilter] = useState<'all' | 'high'>('all');
  const shown = filter === 'high' ? rows.filter((r) => r.reasons.some((x) => x.severity === 'high')) : rows;
  const high = rows.filter((r) => r.reasons.some((x) => x.severity === 'high')).length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter">
        <Button size="sm" variant={filter === 'all' ? 'primary' : 'outline'} onClick={() => setFilter('all')}>Everything ({num(rows.length)})</Button>
        <Button size="sm" variant={filter === 'high' ? 'primary' : 'outline'} onClick={() => setFilter('high')}>Act now ({num(high)})</Button>
      </div>
      {shown.length === 0 ? <p className="card p-6 text-center text-sm text-muted">{rows.length === 0 ? 'Nothing needs attention. Every workspace looks healthy.' : 'Nothing in this group.'}</p> : (
        <ul className="flex flex-col gap-3">{shown.map((r) => (
          <li key={r.id} className="card flex flex-col gap-2 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link href={`/admin/workspaces/${r.id}`} className="font-display text-base font-bold underline-offset-2 hover:underline">{r.name}</Link>
              <span className="text-xs text-muted">{r.owner ?? 'No owner'} · <span className="capitalize">{r.plan}</span></span>
            </div>
            <ul className="flex flex-col gap-1.5 text-sm">{r.reasons.map((x) => (
              <li key={x.code} className="flex items-start gap-2"><span className={cn('mt-0.5 shrink-0 rounded px-1.5 text-xs font-bold', SEV[x.severity])}>{SEV_LABEL[x.severity]}</span><span className="min-w-0">{x.detail}</span></li>))}
            </ul>
          </li>))}
        </ul>)}
    </div>
  );
}

/* ------------------------------------------------------------------ closures */
export function Closures({ pending: p0, closed }: { pending: ClosureRow[]; closed: ClosedRow[] }) {
  const [rows, setRows] = useState(p0); const [target, setTarget] = useState<ClosureRow | null>(null); const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, start] = useTransition();
  return (
    <div className="flex flex-col gap-5">
      <Banner m={msg} />
      <section aria-label="Waiting to close"><h2 className="mb-2 font-display text-lg font-bold">Waiting to close</h2>
        {rows.length === 0 ? <p className="card p-5 text-sm text-muted">No workspace has asked to close.</p> : (
          <ul className="flex flex-col gap-3">{rows.map((r) => (
            <li key={r.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0 text-sm"><Link href={`/admin/workspaces/${r.id}`} className="font-display text-base font-bold underline-offset-2 hover:underline">{r.name}</Link>
                <p className="text-muted">Asked by {r.requestedBy ?? 'unknown'} on {day(r.requestedAt)} · <span className="capitalize">{r.plan}</span> · {num(r.contacts)} contacts · {num(r.members)} people</p>
                <p className={cn('font-semibold', r.inProgress ? 'text-rose' : r.daysLeft <= 3 ? 'text-amber' : '')}>{r.inProgress ? 'Erasing now. This cannot be undone.' : `Closes on ${day(r.dueAt)} (${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'} left)`}</p></div>
              {r.inProgress ? null : <Button variant="outline" onClick={() => { setTarget(r); setReason(''); }}>Stop this closure</Button>}
            </li>))}
          </ul>)}
      </section>
      <section aria-label="Closed"><h2 className="mb-2 font-display text-lg font-bold">Closed recently</h2>
        {closed.length === 0 ? <p className="card p-5 text-sm text-muted">Nothing has been erased yet.</p> : (
          <div className="card relative overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead className="text-left text-xs uppercase tracking-wide text-muted"><tr><th className="p-3">Workspace</th><th className="p-3">Plan</th><th className="p-3">Asked</th><th className="p-3">Erased</th></tr></thead>
            <tbody className="divide-y divide-line">{closed.map((c) => <tr key={c.id}><td className="p-3"><Link href={`/admin/workspaces/${c.id}`} className="underline-offset-2 hover:underline">{c.name}</Link></td><td className="p-3 capitalize">{c.plan}</td><td className="p-3 text-xs text-muted">{day(c.requestedAt)}</td><td className="p-3 text-xs text-muted">{day(c.closedAt)}</td></tr>)}</tbody></table></div>)}
      </section>
      {target ? (
        <Modal open onClose={() => setTarget(null)} title={`Stop closing ${target.name}?`}>
          <div className="mt-2 flex flex-col gap-3">
            <p className="text-sm">The workspace keeps all its data and carries on as before. The owner is not told, so contact them yourself. This is logged under your name.</p>
            <Field label="Reason (required, kept in the log)"><Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. the owner asked on the phone to keep it" /></Field>
            <div className="flex gap-2"><Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
              <Button className="flex-1" disabled={busy || reason.trim().length < 5} onClick={() => start(async () => {
                const r = await cancelClosure(target.id, reason); setTarget(null);
                if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
                setMsg({ ok: true, text: r.data.changed ? `${target.name} will stay open.` : 'It was not closing.' });
                const l = await loadClosures(); if (l.ok) setRows(l.data.pending);
              })}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}Keep it open</Button></div>
          </div>
        </Modal>) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ accounts */
export function Accounts({ initial }: { initial: UserRow[] }) {
  const [rows, setRows] = useState(initial); const [q, setQ] = useState(''); const [err, setErr] = useState(''); const [busy, start] = useTransition();
  const [target, setTarget] = useState<UserRow | null>(null); const [reason, setReason] = useState(''); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const go = (s = q) => start(async () => { setErr(''); const r = await searchUsers(s); if (!r.ok) { setErr(r.error); return; } setRows(r.data); });
  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-wrap gap-2" role="search" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden /><Input aria-label="Search people" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Email or name" maxLength={80} /></div>
        <Button type="submit" disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}Search</Button>
      </form>
      <p className="text-xs text-muted">Every search is written to the audit log with the words you searched.</p>
      {err ? <FormError>{err}</FormError> : null}<Banner m={msg} />
      {rows.length === 0 ? <p className="card p-6 text-center text-sm text-muted">Nobody matches.</p> : (
        <ul className="flex flex-col gap-3">{rows.map((u) => (
          <li key={u.id} className="card flex flex-col gap-2 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="min-w-0 break-all font-semibold">{u.name} <span className="font-normal text-muted">{u.email}</span>{u.staff ? <span className="ml-2 rounded bg-rose/15 px-1.5 text-xs font-bold text-rose">Staff</span> : null}{!u.verified ? <span className="ml-2 rounded bg-amber/15 px-1.5 text-xs font-bold text-amber">Email not verified</span> : null}</span>
              <span className="text-xs text-muted">Joined {day(u.createdAt)}</span>
            </div>
            <p className="text-sm text-muted">{u.sessions} sign-in{u.sessions === 1 ? '' : 's'} active{u.lastSeen ? ` · last seen ${when(u.lastSeen)}` : ''}</p>
            <ul className="flex flex-wrap gap-2 text-sm">{u.workspaces.length === 0 ? <li className="text-muted">Not in any workspace.</li> : u.workspaces.map((w) => <li key={w.id}><Link href={`/admin/workspaces/${w.id}`} className="rounded-full bg-card2 px-3 py-1 underline-offset-2 hover:underline">{w.name} <span className="text-muted">· {w.role}</span></Link></li>)}</ul>
            {u.sessions > 0 && !u.staff ? <div><Button size="sm" variant="outline" onClick={() => { setTarget(u); setReason(''); }}>Sign them out everywhere</Button></div> : null}
          </li>))}
        </ul>)}
      {target ? (
        <Modal open onClose={() => setTarget(null)} title={`Sign out ${target.name}?`}>
          <div className="mt-2 flex flex-col gap-3">
            <p className="text-sm">All {target.sessions} of their sign-ins end now, on every phone and computer. They can sign in again with their password. This is logged under your name.</p>
            <Field label="Reason (required, kept in the log)"><Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. lost phone, the owner asked" /></Field>
            <div className="flex gap-2"><Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
              <Button className="flex-1" disabled={busy || reason.trim().length < 5} onClick={() => start(async () => {
                const r = await signOutUser(target.id, reason); setTarget(null);
                setMsg(r.ok ? { ok: true, text: `Ended ${r.data.ended} sign-in${r.data.ended === 1 ? '' : 's'} for ${target.name}.` } : { ok: false, text: r.error }); go();
              })}>Sign out</Button></div>
          </div>
        </Modal>) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ revenue */
const monthName = (m: string) => new Date(`${m}-01T00:00:00+05:30`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
export function RevenueView({ r }: { r: Revenue }) {
  const total = r.byPlan.reduce((a, b) => a + Number(b.paise), 0); const subs = r.byPlan.reduce((a, b) => a + b.count, 0);
  const unpriced = r.byPlan.reduce((a, b) => a + (b.unpriced ?? 0), 0);
  return (
    <div className="flex flex-col gap-6">
      {unpriced > 0 ? <p role="alert" className="rounded-xl bg-amber/10 p-3 text-sm text-amber"><strong>{num(unpriced)} active subscription{unpriced === 1 ? ' has' : 's have'} no known price,</strong> so the figures below are lower than the real total. Its Razorpay plan is missing from this platform&apos;s plan list. Check the plan in Razorpay.</p> : null}
      <section aria-label="Now" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted">Monthly recurring</p><p className="mt-1 font-display text-2xl font-extrabold tabular-nums">{inr(total)}</p><p className="text-xs text-muted">Active subscriptions, including GST</p></div>
        <div className="card p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted">Active subscriptions</p><p className="mt-1 font-display text-2xl font-extrabold tabular-nums">{num(subs)}</p></div>
        <div className="card p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted">Halted</p><p className={cn('mt-1 font-display text-2xl font-extrabold tabular-nums', (r.subs.halted ?? 0) ? 'text-rose' : '')}>{num(r.subs.halted ?? 0)}</p><p className="text-xs text-muted">Payments stopped</p></div>
        <div className="card p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted">Cancelled</p><p className="mt-1 font-display text-2xl font-extrabold tabular-nums">{num(r.subs.cancelled ?? 0)}</p></div>
      </section>
      <section aria-label="By plan" className="card p-4"><h2 className="mb-2 font-display text-lg font-bold">By plan</h2>
        {r.byPlan.length === 0 ? <p className="text-sm text-muted">No active subscriptions yet.</p> : <ul className="flex flex-col divide-y divide-line text-sm">{r.byPlan.map((p) => <li key={p.plan} className="flex justify-between gap-2 py-2"><span className="capitalize">{p.plan} · {num(p.count)}{p.unpriced ? <span className="ml-2 rounded bg-amber/15 px-1.5 text-xs font-bold normal-case text-amber">{p.unpriced} unpriced</span> : null}</span><span className="tabular-nums">{inr(Number(p.paise))}</span></li>)}</ul>}</section>
      <section aria-label="Invoices by month" className="card relative overflow-x-auto p-4"><h2 className="mb-2 font-display text-lg font-bold">Invoices, last six months</h2>
        {r.months.length === 0 ? <p className="text-sm text-muted">No invoices yet.</p> : <table className="w-full min-w-[480px] text-sm"><thead className="text-left text-xs uppercase tracking-wide text-muted"><tr><th className="py-2">Month</th><th className="py-2 text-right">Invoices</th><th className="py-2 text-right">Before GST</th><th className="py-2 text-right">GST</th><th className="py-2 text-right">Total</th></tr></thead>
          <tbody className="divide-y divide-line">{r.months.map((m) => <tr key={m.month}><td className="py-2">{monthName(m.month)}</td><td className="py-2 text-right tabular-nums">{num(m.count)}</td><td className="py-2 text-right tabular-nums">{inr(Number(m.basePaise))}</td><td className="py-2 text-right tabular-nums">{inr(Number(m.gstPaise))}</td><td className="py-2 text-right font-semibold tabular-nums">{inr(Number(m.totalPaise))}</td></tr>)}</tbody></table>}</section>
      <section aria-label="Renewals" className="card p-4"><h2 className="mb-2 font-display text-lg font-bold">Renewing in the next 14 days</h2>
        {r.renewals.length === 0 ? <p className="text-sm text-muted">None.</p> : <ul className="flex flex-col divide-y divide-line text-sm">{r.renewals.map((x) => <li key={x.id} className="flex flex-wrap justify-between gap-2 py-2"><Link href={`/admin/workspaces/${x.id}`} className="underline-offset-2 hover:underline">{x.name} <span className="capitalize text-muted">· {x.plan}</span></Link><span className={x.cancelAtEnd ? 'text-amber' : 'text-muted'}>{day(x.end)}{x.cancelAtEnd ? ' · will cancel' : ''}</span></li>)}</ul>}</section>
      <section aria-label="Latest invoices" className="card p-4"><h2 className="mb-2 font-display text-lg font-bold">Latest invoices</h2>
        {r.recent.length === 0 ? <p className="text-sm text-muted">None yet.</p> : <ul className="flex flex-col divide-y divide-line text-sm">{r.recent.map((x) => <li key={x.number} className="flex flex-wrap justify-between gap-2 py-2"><span><span className="font-mono text-xs">{x.number}</span> · <Link href={`/admin/workspaces/${x.tenantId}`} className="underline-offset-2 hover:underline">{x.tenant ?? 'Deleted workspace'}</Link></span><span className="tabular-nums">{inr(x.totalPaise)} <span className="text-xs text-muted">· {day(x.at)}</span></span></li>)}</ul>}</section>
      <p className="text-xs text-muted">Figures come from this platform&apos;s own records of Razorpay subscriptions and the invoices it issued. For money actually received, check the Razorpay dashboard.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ staff */
export function StaffList({ rows }: { rows: StaffRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="card relative overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className="text-left text-xs uppercase tracking-wide text-muted"><tr><th className="p-3">Person</th><th className="p-3">Staff since</th><th className="p-3">Added by</th><th className="p-3 text-right">Actions, 30 days</th><th className="p-3">Last action</th><th className="p-3 text-right">Sign-ins</th></tr></thead>
        <tbody className="divide-y divide-line">{rows.map((s) => <tr key={s.id}><td className="p-3 font-semibold">{s.name}<br /><span className="break-all text-xs font-normal text-muted">{s.email}</span></td><td className="p-3 text-xs text-muted">{day(s.since)}</td><td className="p-3 text-xs text-muted">{s.addedBy ?? 'Set up on the server'}</td><td className="p-3 text-right tabular-nums">{num(s.actions30d)}</td><td className="p-3 text-xs text-muted">{when(s.lastAction)}</td><td className="p-3 text-right tabular-nums">{s.sessions}</td></tr>)}</tbody></table></div>
      <p className="text-xs text-muted">Staff are added and removed only from the server, never from this panel, so nobody can promote themselves. Run <code className="rounded bg-card2 px-1">pnpm --filter @lbc/db admin:add &lt;email&gt;</code> or <code className="rounded bg-card2 px-1">admin:remove</code>.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ one workspace: notes, send errors, closure */
export function WorkspaceExtra({ id, initial }: { id: string; initial: TenantExtra }) {
  const [x, setX] = useState(initial); const [note, setNote] = useState(''); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, start] = useTransition();
  return (
    <div className="flex flex-col gap-4">
      {x.closure ? <p className="rounded-xl bg-amber/10 p-3 text-sm text-amber"><strong>{x.closure.closedAt ? `Closed and erased ${day(x.closure.closedAt)}.` : `Closing on ${day(x.closure.dueAt)}.`}</strong> Asked by {x.closure.requestedBy ?? 'unknown'} on {day(x.closure.requestedAt)}. {x.closure.closedAt ? '' : <Link href="/admin/closures" className="underline">Manage closures</Link>}</p> : null}
      <section className="card min-w-0 p-4" aria-label="Send errors"><h2 className="mb-2 font-display text-lg font-bold">Why sends failed, last 7 days</h2>
        {x.errors.length === 0 ? <p className="text-sm text-muted">No failed sends.</p> : <ul className="flex flex-col divide-y divide-line text-sm">{x.errors.map((e, i) => <li key={i} className="flex flex-wrap justify-between gap-2 py-1.5"><span className="min-w-0">{e.code === null ? 'No error code recorded' : <><span className="font-mono text-xs">{e.code}</span> · {ERROR_WORDS[e.code] ?? 'Meta error'}</>}</span><span className="tabular-nums text-muted">{num(e.count)}</span></li>)}</ul>}</section>
      <section className="card min-w-0 p-4" aria-label="Staff notes"><h2 className="mb-2 font-display text-lg font-bold">Staff notes</h2>
        <p className="mb-2 text-xs text-muted">Only platform staff can see these. The customer cannot.</p>
        <Banner m={msg} />
        <div className="mt-2 flex flex-col gap-2"><Field label="Add a note"><Textarea value={note} maxLength={1000} rows={3} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Spoke to the owner on 18 Nov, they will reconnect WhatsApp tomorrow." /></Field>
          <Button className="w-fit" disabled={busy || note.trim().length < 3} onClick={() => start(async () => {
            const r = await addNote(id, note);
            if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
            setMsg({ ok: true, text: 'Note saved.' }); setNote('');
            const { loadTenantExtra } = await import('@/app/(admin)/admin/actions'); const n = await loadTenantExtra(id); if (n.ok) setX(n.data);
          })}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}Save note</Button></div>
        <ul className="mt-3 flex flex-col divide-y divide-line text-sm">{x.notes.length === 0 ? <li className="py-2 text-muted">No notes yet.</li> : x.notes.map((n) => <li key={n.id} className="py-2"><p className="whitespace-pre-wrap break-words">{n.note}</p><p className="text-xs text-muted">{n.by ?? 'Unknown'} · {when(n.at)}</p></li>)}</ul></section>
    </div>
  );
}
