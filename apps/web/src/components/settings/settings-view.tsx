'use client';

import { SecurityTab } from '@/components/settings/security-tab';
import { CloseWorkspace } from './close-workspace';
import { useEffect, useState, useTransition } from 'react';
import { Check, Copy, Loader2, Moon, Trash2, UserPlus } from 'lucide-react';
import { hourLabel } from '@lbc/shared/send-window';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select } from '@/components/ui/form';
import { WhatsAppConnect } from './whatsapp-connect';
import { BillingPanel } from './billing-panel';
import { ApiKeysPanel } from './api-keys-panel';
import { Modal } from '@/components/ui/modal';
import { changeRole, inviteMember, loadQuiet, loadTeam, removeMember, revokeInvite, saveProfile, saveQuiet, type QuietSettings } from '@/app/(app)/settings/actions';
import { cn } from '@/lib/utils';

type Team = Awaited<ReturnType<typeof loadTeam>>;
interface Profile { name: string; legalName: string; gstin: string; vertical: string | null; review: string; plan: string; status: string }
type Tab = 'workspace' | 'team' | 'whatsapp' | 'plan' | 'ai' | 'security';

export function SettingsView({ team: t0, profile: p0, role, me }: { team: Team; profile: Profile; role: string; me: string }) {
  const [tab, setTab] = useState<Tab>(typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tab') === 'security' ? 'security' : 'workspace');
  const [team, setTeam] = useState(t0);
  const isOwner = role === 'owner', isAdmin = isOwner || role === 'admin';
  const tabs: [Tab, string][] = [['workspace', 'Business'], ['team', 'Team'], ['whatsapp', 'WhatsApp'], ['plan', 'Plan and billing'], ['ai', 'AI assistants'], ['security', 'Security']];
  return (
    <div className="flex flex-col gap-5">
      <div><h2 className="font-display text-2xl font-extrabold">Settings</h2><p className="text-sm text-muted">Your business, team, WhatsApp number and plan.</p></div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" role="tablist">{tabs.map(([id, l]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn('min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold', tab === id ? 'grad-bg border-transparent text-white' : 'border-line bg-card text-muted')}>{l}</button>)}</div>
      {tab === 'workspace' ? <div className="flex flex-col gap-5"><WorkspaceTab p={p0} canEdit={isAdmin} /><QuietHoursCard canEdit={isAdmin} />{isOwner ? <CloseWorkspace /> : null}</div> : null}
      {tab === 'team' ? <TeamTab team={team} reload={async () => setTeam(await loadTeam())} isOwner={isOwner} isAdmin={isAdmin} me={me} /> : null}
      {tab === 'whatsapp' ? <WhatsAppConnect /> : null}
      {tab === 'plan' ? <BillingPanel /> : null}
      {tab === 'ai' ? <ApiKeysPanel canManage={isAdmin} /> : null}
      {tab === 'security' ? <SecurityTab /> : null}
    </div>
  );
}

function WorkspaceTab({ p, canEdit }: { p: Profile; canEdit: boolean }) {
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [pending, start] = useTransition();
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setMsg(null);
    start(async () => { const r = await saveProfile({ name: String(f.get('name')), legalName: String(f.get('legalName')), gstin: String(f.get('gstin')) }); setMsg(r.ok ? { ok: true, t: 'Saved.' } : { ok: false, t: r.error }); });
  }
  return (
    <form onSubmit={submit} className="card flex max-w-2xl flex-col gap-4 p-5">
      {msg ? <p role="status" className={cn('rounded-xl px-3 py-2 text-sm', msg.ok ? 'bg-brand/10 text-brand' : 'bg-rose/10 text-rose')}>{msg.t}</p> : null}
      <Field label="Business name"><Input name="name" defaultValue={p.name} required disabled={!canEdit} maxLength={80} /></Field>
      <Field label="Legal name (for invoices)"><Input name="legalName" defaultValue={p.legalName} disabled={!canEdit} maxLength={120} /></Field>
      <Field label="GSTIN (optional)" hint="Used on invoices so you can claim GST input credit."><Input name="gstin" defaultValue={p.gstin} disabled={!canEdit} maxLength={15} className="uppercase" /></Field>
      <p className="text-sm text-muted">Business type: <strong className="text-ink">{p.vertical ?? 'Not set'}</strong>{p.review === 'flagged' ? ' · under review' : ''}</p>
      {canEdit ? <Button type="submit" disabled={pending} className="w-fit">{pending ? <Loader2 className="size-4 animate-spin" /> : null}Save changes</Button> : <p className="text-sm text-muted">Only owners and admins can edit this.</p>}
    </form>
  );
}

function QuietHoursCard({ canEdit }: { canEdit: boolean }) {
  const [q, setQ] = useState<QuietSettings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => { void loadQuiet().then(setQ); }, []);
  if (!q) return <div className="card h-40 max-w-2xl animate-pulse" aria-hidden />;
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <section className="card flex max-w-2xl flex-col gap-3 p-5" aria-label="Quiet hours">
      <h3 className="flex items-center gap-2 font-display text-lg font-bold"><Moon className="size-5 text-brand" />Quiet hours</h3>
      <p className="text-sm text-muted">Promotional messages wait until the quiet hours end, so customers are not messaged at night. Replies and updates they expect are never held back. Times are in {q.timezone === 'Asia/Kolkata' ? 'Indian time (IST)' : q.timezone}.</p>
      {msg ? <p role="status" className={cn('rounded-xl px-3 py-2 text-sm', msg.ok ? 'bg-brand/10 text-brand' : 'bg-rose/10 text-rose')}>{msg.t}</p> : null}
      <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" className="size-5" checked={q.enabled} disabled={!canEdit} onChange={(e) => setQ({ ...q, enabled: e.target.checked })} />Hold promotional messages during quiet hours</label>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quiet from"><Select value={q.startHour} disabled={!canEdit || !q.enabled} onChange={(e) => setQ({ ...q, startHour: Number(e.target.value) })}>{hours.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</Select></Field>
        <Field label="Until"><Select value={q.endHour} disabled={!canEdit || !q.enabled} onChange={(e) => setQ({ ...q, endHour: Number(e.target.value) })}>{hours.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</Select></Field>
      </div>
      {canEdit ? <Button type="button" disabled={pending} className="w-fit" onClick={() => start(async () => { const r = await saveQuiet({ enabled: q.enabled, startHour: q.startHour, endHour: q.endHour }); setMsg(r.ok ? { ok: true, t: 'Saved.' } : { ok: false, t: r.error }); })}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}Save quiet hours</Button> : <p className="text-sm text-muted">Only owners and admins can change this.</p>}
    </section>
  );
}

function TeamTab({ team, reload, isOwner, isAdmin, me }: { team: Team; reload: () => Promise<void>; isOwner: boolean; isAdmin: boolean; me: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const [emailed, setEmailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState('');
  const [pending, start] = useTransition();
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000); };
  function invite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError('');
    start(async () => { const r = await inviteMember({ email: String(f.get('email')), role: String(f.get('role')) as 'agent' }); if (!r.ok) { setError(r.error); return; } setLink(r.data.link); setEmailed(r.data.emailed); await reload(); });
  }
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted"><strong className="text-ink tabular">{team.used}</strong> of {team.seats} seats used</p>{isAdmin ? <Button onClick={() => { setOpen(true); setLink(''); setError(''); }}><UserPlus className="size-4" />Invite someone</Button> : null}</div>
      <ul className="card divide-y divide-line p-0">{team.members.map((m) => (
        <li key={m.userId} className="flex flex-wrap items-center gap-3 p-4">
          <span className="grad-bg flex size-10 shrink-0 items-center justify-center rounded-full font-bold text-white">{m.name.slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0 flex-1"><p className="truncate font-semibold">{m.name}{m.userId === me ? ' (you)' : ''}</p><p className="truncate text-sm text-muted">{m.email}</p></div>
          {isOwner && m.role !== 'owner' ? <Select aria-label={`Role of ${m.name}`} value={m.role} onChange={(e) => start(async () => { const r = await changeRole(m.userId, e.target.value as 'agent'); flash(r.ok ? 'Role updated.' : r.error); await reload(); })} className="min-h-10 w-32 text-sm"><option value="admin">Admin</option><option value="agent">Agent</option><option value="viewer">Viewer</option></Select> : <span className="rounded-full bg-ink/5 px-3 py-1 text-xs font-bold capitalize">{m.role}</span>}
          {isAdmin && m.role !== 'owner' && m.userId !== me ? <Button variant="ghost" size="icon" aria-label={`Remove ${m.name}`} onClick={() => { if (confirm(`Remove ${m.name} from this workspace?`)) start(async () => { const r = await removeMember(m.userId); flash(r.ok ? 'Removed.' : r.error); await reload(); }); }}><Trash2 className="size-4 text-rose" /></Button> : null}
        </li>))}</ul>
      {team.invites.length ? <div><h3 className="mb-2 text-sm font-bold">Pending invitations</h3><ul className="card divide-y divide-line p-0">{team.invites.map((i) => <li key={i.id} className="flex items-center gap-3 p-3 text-sm"><span className="min-w-0 flex-1 truncate">{i.email}</span><span className="rounded-full bg-amber/15 px-2.5 py-1 text-xs font-bold capitalize text-amber">{i.role}</span>{isAdmin ? <Button size="sm" variant="ghost" onClick={() => start(async () => { await revokeInvite(i.id); await reload(); })}>Revoke</Button> : null}</li>)}</ul></div> : null}
      <p className="text-xs text-muted">Roles: <strong>Admin</strong> manages contacts, campaigns and templates. <strong>Agent</strong> answers chats. <strong>Viewer</strong> can only look.</p>
      <Modal open={open} onClose={() => setOpen(false)} title="Invite someone">
        {link ? (
          <div className="flex flex-col gap-3"><p className="flex items-center gap-2 font-semibold text-brand"><Check className="size-5" />Invitation created</p>
            <p className="text-sm text-muted">{emailed ? 'We emailed them the invitation. If it does not arrive, you can also copy this link and send it on WhatsApp.' : 'We could not email it, so copy this link and send it to them on WhatsApp.'} It works once, only for the invited email, and expires in 7 days.</p>
            <div className="break-all rounded-xl bg-card2 p-3 font-mono text-xs">{link}</div>
            <Button onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }}><Copy className="size-4" />{copied ? 'Copied' : 'Copy link'}</Button></div>
        ) : (
          <form onSubmit={invite} className="flex flex-col gap-4"><FormError>{error}</FormError>
            <Field label="Email address"><Input name="email" type="email" required autoFocus /></Field>
            <Field label="Role"><Select name="role" defaultValue="agent"><option value="admin">Admin</option><option value="agent">Agent</option><option value="viewer">Viewer</option></Select></Field>
            <Button type="submit" disabled={pending}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}Create invitation</Button></form>)}
      </Modal>
      {toast ? <div role="status" className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-bg shadow-xl md:bottom-8">{toast}</div> : null}
    </div>
  );
}
