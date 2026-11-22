'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';
import { announce, endAnnouncement, loadAnnouncements, loadAudit, loadTenants, setReview, setSuspended, type AnnouncementRow, type AuditRow, type TenantDetail, type TenantRow } from '@/app/(admin)/admin/actions';

const num = (n: number) => n.toLocaleString('en-IN');
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : 'Never');
const STATUS: Record<string, string> = { pending_meta: 'Not connected', onboarding: 'Getting set up', ready: 'Active', suspended: 'Suspended', offboarded: 'Left' };
const TONE: Record<string, string> = { ready: 'bg-brand/15 text-brand', onboarding: 'bg-indigo/15 text-indigo', suspended: 'bg-rose/15 text-rose', offboarded: 'bg-ink/10', pending_meta: 'bg-amber/15 text-amber' };
const Pill = ({ s }: { s: string }) => <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-bold', TONE[s] ?? 'bg-ink/10')}>{STATUS[s] ?? s}</span>;

export function WorkspacesList({ initial, total: t0, pageSize }: { initial: TenantRow[]; total: number; pageSize: number }) {
  const [rows, setRows] = useState(initial); const [total, setTotal] = useState(t0);
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [page, setPage] = useState(1);
  const [err, setErr] = useState(''); const [pending, start] = useTransition();
  const go = (p: number, s = q, st = status) => start(async () => { setErr(''); const r = await loadTenants(s, st, p); if (!r.ok) { setErr(r.error); return; } setRows(r.data.rows); setTotal(r.data.total); setPage(p); });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); go(1); }} role="search">
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden /><Input aria-label="Search" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Business name, owner email or workspace id" maxLength={80} /></div>
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); go(1, q, e.target.value); }} className="w-44"><option value="">All statuses</option>{Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        <Button type="submit" disabled={pending}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}Search</Button>
      </form>
      {err ? <FormError>{err}</FormError> : null}
      <div className="card relative overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-muted"><tr><th className="p-3">Workspace</th><th className="p-3">Status</th><th className="p-3">Plan</th><th className="p-3 text-right">Contacts</th><th className="p-3 text-right">Sent, 30 days</th><th className="p-3">WhatsApp</th><th className="p-3">Last active</th></tr></thead>
        <tbody className="divide-y divide-line">{rows.map((r) => (
          <tr key={r.id} className="hover:bg-ink/[0.03]">
            <td className="p-3"><Link href={`/admin/workspaces/${r.id}`} className="font-semibold underline-offset-2 hover:underline">{r.name}</Link><br /><span className="text-xs text-muted">{r.owner ?? 'No owner'} · {r.members} member{r.members === 1 ? '' : 's'}</span></td>
            <td className="p-3"><Pill s={r.status} />{r.review === 'flagged' ? <span className="ml-1 rounded-full bg-amber/15 px-2 py-0.5 text-xs font-bold text-amber">Review</span> : null}{r.review === 'blocked' ? <span className="ml-1 rounded-full bg-rose/15 px-2 py-0.5 text-xs font-bold text-rose">Blocked</span> : null}</td>
            <td className="p-3 capitalize">{r.plan}</td><td className="p-3 text-right tabular-nums">{num(r.contacts)}</td><td className="p-3 text-right tabular-nums">{num(r.sent30d)}</td>
            <td className="p-3">{r.token ? (r.token === 'valid' && r.health === 'ok' ? <span className="text-brand">Connected</span> : <span className="text-rose">{r.token !== 'valid' ? 'Needs reconnect' : 'Restricted'}</span>) : <span className="text-muted">None</span>}</td>
            <td className="p-3 text-xs text-muted">{when(r.lastActive)}</td>
          </tr>))}</tbody></table>
        {rows.length === 0 ? <p className="p-6 text-center text-sm text-muted">No workspaces match.</p> : null}
      </div>
      <div className="flex items-center justify-between text-sm"><span className="text-muted">{num(total)} workspace{total === 1 ? '' : 's'}</span>
        <span className="flex items-center gap-2"><Button size="sm" variant="outline" aria-label="Previous page" disabled={page <= 1 || pending} onClick={() => go(page - 1)}><ChevronLeft className="size-4" /></Button>Page {page} of {pages}<Button size="sm" variant="outline" aria-label="Next page" disabled={page >= pages || pending} onClick={() => go(page + 1)}><ChevronRight className="size-4" /></Button></span></div>
    </div>
  );
}

export function WorkspaceDetail({ t }: { t: TenantDetail }) {
  const [cur, setCur] = useState(t);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dlg, setDlg] = useState<'suspend' | 'reactivate' | null>(null);
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  const say = (ok: boolean, text: string) => setMsg({ ok, text });
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3"><Link href="/admin/workspaces" className="text-sm underline">All workspaces</Link><h1 className="font-display text-2xl font-bold">{cur.name}</h1><Pill s={cur.status} /></div>
      {msg ? <p role={msg.ok ? 'status' : 'alert'} className={cn('rounded-xl px-3 py-2 text-sm', msg.ok ? 'bg-brand/10 text-brand' : 'bg-rose/10 text-rose')}>{msg.text}</p> : null}
      {cur.status === 'suspended' ? <p className="rounded-xl bg-rose/10 p-3 text-sm text-rose"><strong>Suspended {when(cur.suspendedAt)}.</strong> Reason: {cur.suspendedReason}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="card min-w-0 p-4" aria-label="Business"><h2 className="mb-2 font-display text-lg font-bold">Business</h2>
          <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-y-1.5 text-sm"><dt className="text-muted">Legal name</dt><dd>{cur.legalName ?? '—'}</dd><dt className="text-muted">GSTIN</dt><dd>{cur.gstin ?? '—'}</dd><dt className="text-muted">Business type</dt><dd>{cur.vertical ?? '—'}</dd><dt className="text-muted">Joined</dt><dd>{when(cur.createdAt)}</dd><dt className="text-muted">Workspace id</dt><dd className="break-all font-mono text-xs [overflow-wrap:anywhere]">{cur.id}</dd></dl></section>
        <section className="card min-w-0 p-4" aria-label="WhatsApp"><h2 className="mb-2 font-display text-lg font-bold">WhatsApp</h2>
          {cur.connection ? <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-y-1.5 text-sm"><dt className="text-muted">Number</dt><dd>{cur.connection.phone?.display ?? '—'} {cur.connection.phone?.name ? `(${cur.connection.phone.name})` : ''}</dd><dt className="text-muted">Connection</dt><dd className={cur.connection.token === 'valid' ? 'text-brand' : 'text-rose'}>{cur.connection.token === 'valid' ? 'Connected' : 'Needs reconnect'}</dd><dt className="text-muted">Account health</dt><dd className={cur.connection.health === 'ok' ? '' : 'text-rose'}>{cur.connection.health}</dd><dt className="text-muted">Number quality</dt><dd>{cur.connection.phone?.quality ?? '—'}</dd><dt className="text-muted">Card on Meta</dt><dd>{cur.connection.payment}</dd></dl> : <p className="text-sm text-muted">Not connected.</p>}</section>
        <section className="card min-w-0 p-4" aria-label="Usage"><h2 className="mb-2 font-display text-lg font-bold">Usage</h2>
          <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-y-1.5 text-sm"><dt className="text-muted">Contacts</dt><dd>{num(cur.usage.contacts)}</dd><dt className="text-muted">Sent in 30 days</dt><dd>{num(cur.usage.sent30d)} ({num(cur.usage.failed30d)} failed)</dd><dt className="text-muted">Campaigns</dt><dd>{num(cur.usage.campaigns)}</dd><dt className="text-muted">Templates</dt><dd>{num(cur.usage.templates)}</dd><dt className="text-muted">Journeys running</dt><dd>{num(cur.usage.journeysActive)}</dd></dl></section>
        <section className="card min-w-0 p-4" aria-label="People"><h2 className="mb-2 font-display text-lg font-bold">People</h2>
          <ul className="flex flex-col divide-y divide-line text-sm">{cur.members.map((m, i) => <li key={i} className="flex justify-between gap-2 py-1.5"><span className="min-w-0 truncate">{m.name} <span className="text-muted">{m.email}</span></span><span className="capitalize text-muted">{m.role}</span></li>)}</ul></section>
      </div>

      <section className="card flex flex-col gap-4 p-4" aria-label="Actions"><h2 className="font-display text-lg font-bold">Actions</h2>
        <div className="flex flex-wrap gap-2 pt-1">
          {(['none', 'flagged', 'approved', 'blocked'] as const).map((v) => <Button key={v} size="sm" variant={cur.review === v ? 'primary' : 'outline'} disabled={pending || cur.review === v} onClick={() => start(async () => { const r = await setReview(cur.id, v); if (!r.ok) say(false, r.error); else { say(true, `Business review: ${v}.`); setCur({ ...cur, review: v }); } })}>{{ none: 'No review needed', flagged: 'Flag for review', approved: 'Approve', blocked: 'Block' }[v]}</Button>)}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          {cur.status === 'suspended' ? <Button variant="outline" onClick={() => setDlg('reactivate')}>Reactivate</Button> : cur.status === 'offboarded' ? <span className="text-sm text-muted">This workspace left the platform.</span> : <Button variant="outline" className="border-rose text-rose" onClick={() => setDlg('suspend')}>Suspend workspace</Button>}
        </div>
      </section>

      <section className="card min-w-0 p-4" aria-label="Recent activity"><h2 className="mb-2 font-display text-lg font-bold">Recent activity</h2>
        <ul className="flex flex-col divide-y divide-line text-sm">{cur.recent.length === 0 ? <li className="py-2 text-muted">Nothing yet.</li> : cur.recent.map((r, i) => <li key={i} className="flex justify-between gap-2 py-1.5"><span>{r.action} <span className="text-xs text-muted">({r.actor})</span></span><span className="text-xs text-muted">{when(r.at)}</span></li>)}</ul>
        <Link href={`/admin/audit?tenant=${cur.id}`} className="mt-2 inline-block text-sm underline">See everything for this workspace</Link></section>

      {dlg ? (
        <Modal open onClose={() => setDlg(null)} title={dlg === 'suspend' ? `Suspend ${cur.name}?` : `Reactivate ${cur.name}?`}>
          <div className="mt-2 flex flex-col gap-3">
            {dlg === 'suspend' ? <>
              <p className="text-sm">Their people can still sign in, but nothing is sent. All running campaigns and journeys are paused. This is logged under your name.</p>
              <Field label="Reason (required, kept in the log)"><Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. spam complaints, see ticket 123" /></Field></>
              : <p className="text-sm">The workspace goes back to how it was. Campaigns and journeys stay paused until the owner starts them again.</p>}
            <div className="flex gap-2"><Button variant="outline" onClick={() => setDlg(null)}>Cancel</Button>
              <Button className="flex-1" disabled={pending || (dlg === 'suspend' && reason.trim().length < 5)} onClick={() => start(async () => { const r = await setSuspended(cur.id, dlg === 'suspend', reason); setDlg(null); if (!r.ok) { say(false, r.error); return; } say(true, dlg === 'suspend' ? `Suspended. ${r.data.campaignsPaused ?? 0} campaign(s) and ${r.data.journeysPaused ?? 0} journey(s) paused.` : 'Reactivated.'); setReason(''); window.location.reload(); })}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}{dlg === 'suspend' ? 'Suspend' : 'Reactivate'}</Button></div>
          </div>
        </Modal>) : null}
    </div>
  );
}

export function AuditList({ initial, tenant }: { initial: AuditRow[]; tenant: string }) {
  const [rows, setRows] = useState(initial); const [prefix, setPrefix] = useState(''); const [done, setDone] = useState(initial.length < 50);
  const [err, setErr] = useState(''); const [pending, start] = useTransition();
  const fetchMore = (reset: boolean) => start(async () => { setErr(''); const r = await loadAudit(reset ? null : rows[rows.length - 1]?.id ?? null, tenant, prefix); if (!r.ok) { setErr(r.error); return; } setRows(reset ? r.data : [...rows, ...r.data]); setDone(r.data.length < 50); });
  return (
    <div className="flex flex-col gap-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); fetchMore(true); }}><Input aria-label="Action starts with" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="Action starts with, e.g. admin. or campaign." maxLength={40} /><Button type="submit" disabled={pending}>Filter</Button></form>
      {err ? <FormError>{err}</FormError> : null}
      <div className="card relative overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead className="text-left text-xs uppercase tracking-wide text-muted"><tr><th className="p-3">When (IST)</th><th className="p-3">Workspace</th><th className="p-3">Who</th><th className="p-3">What</th></tr></thead>
        <tbody className="divide-y divide-line">{rows.map((r) => <tr key={r.id}><td className="whitespace-nowrap p-3 text-xs text-muted">{when(r.at)}</td><td className="p-3">{r.tenant ?? <span className="text-muted">Platform</span>}</td><td className="p-3">{r.actor ?? <span className="text-muted">{r.actorType}</span>}{r.actorType === 'super_admin' ? <span className="ml-1 rounded bg-rose/15 px-1 text-xs font-bold text-rose">staff</span> : null}</td><td className="p-3"><code className="text-xs">{r.action}</code>{r.after && Object.keys(r.after as object).length ? <span className="block max-w-md truncate text-xs text-muted">{JSON.stringify(r.after)}</span> : null}</td></tr>)}</tbody></table>
        {rows.length === 0 ? <p className="p-6 text-center text-sm text-muted">Nothing here.</p> : null}</div>
      {!done ? <Button variant="outline" disabled={pending} onClick={() => fetchMore(false)}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}Show older</Button> : null}
    </div>
  );
}

export function Announcements({ initial }: { initial: AnnouncementRow[] }) {
  const [rows, setRows] = useState(initial); const [message, setMessage] = useState(''); const [level, setLevel] = useState('info'); const [hours, setHours] = useState('24');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [pending, start] = useTransition();
  const reload = async () => { const r = await loadAnnouncements(); if (r.ok) setRows(r.data); };
  const live = (a: AnnouncementRow) => a.active && (!a.endsAt || new Date(a.endsAt) > new Date());
  return (
    <div className="flex flex-col gap-5">
      <section className="card flex flex-col gap-3 p-4" aria-label="New announcement"><h2 className="font-display text-lg font-bold">Show a message to every workspace</h2>
        <Field label="Message" hint="Appears as a banner at the top of the app. 300 characters at most."><Input value={message} maxLength={300} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Planned maintenance tonight 11 pm to 11:30 pm IST." /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Importance"><Select value={level} onChange={(e) => setLevel(e.target.value)}><option value="info">Information</option><option value="warning">Warning</option><option value="critical">Urgent</option></Select></Field>
          <Field label="Show for"><Select value={hours} onChange={(e) => setHours(e.target.value)}><option value="1">1 hour</option><option value="6">6 hours</option><option value="24">1 day</option><option value="168">1 week</option><option value="720">30 days</option></Select></Field></div>
        {msg ? <p role={msg.ok ? 'status' : 'alert'} className={cn('text-sm', msg.ok ? 'text-brand' : 'text-rose')}>{msg.text}</p> : null}
        <Button className="w-fit" disabled={pending || message.trim().length < 3} onClick={() => start(async () => { const r = await announce(message, level, Number(hours)); if (!r.ok) setMsg({ ok: false, text: r.error }); else { setMsg({ ok: true, text: 'Published. Everyone sees it on their next page load.' }); setMessage(''); await reload(); } })}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}Publish</Button></section>
      <section aria-label="Announcements"><h2 className="mb-2 font-display text-lg font-bold">Recent</h2>
        <ul className="flex flex-col gap-2">{rows.length === 0 ? <li className="text-sm text-muted">None yet.</li> : rows.map((a) => <li key={a.id} className="card flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <span className="min-w-0"><span className={cn('mr-2 rounded px-1.5 text-xs font-bold', a.level === 'critical' ? 'bg-rose/15 text-rose' : a.level === 'warning' ? 'bg-amber/15 text-amber' : 'bg-indigo/15 text-indigo')}>{a.level}</span>{a.message}<br /><span className="text-xs text-muted">{live(a) ? `Live${a.endsAt ? ` until ${when(a.endsAt)}` : ''}` : 'Ended'} · created {when(a.createdAt)}</span></span>
          {live(a) ? <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { await endAnnouncement(a.id); await reload(); })}>End now</Button> : null}</li>)}</ul></section>
    </div>
  );
}
