'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { AlertTriangle, Check, Copy, KeyRound, Loader2, Plus, Power, Search, Trash2, UserCheck } from 'lucide-react';
import { LEAD_STATUSES } from '@lbc/shared';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import {
  bulkUpdateLeads, createSource, deleteSource, listLeads, listSources, loadLeadEvents, rejectsFor, rotateSourceKey, setSourceEnabled, updateLead, updateSource,
  type LeadRow, type LeadsData, type SourceRow, type SourcesData,
} from '@/app/(app)/leads/actions';
import { cn } from '@/lib/utils';
import { ChannelsPanel } from './channels-panel';

const STATUS_LABEL: Record<string, string> = { new: 'New', contacted: 'Contacted', qualified: 'Qualified', won: 'Won', lost: 'Lost', junk: 'Junk' };
const STATUS_STYLE: Record<string, string> = {
  new: 'bg-sky-100 text-sky-800', contacted: 'bg-amber-100 text-amber-800', qualified: 'bg-violet-100 text-violet-800',
  won: 'bg-emerald-100 text-emerald-800', lost: 'bg-slate-200 text-slate-700', junk: 'bg-rose-100 text-rose-800',
};
const CONSENT_LABEL: Record<string, string> = { allowed: 'Can send offers', unknown: 'Reply only', stopped: 'Opted out' };
const CONSENT_STYLE: Record<string, string> = { allowed: 'text-emerald-700', unknown: 'text-amber-700', stopped: 'text-rose-700' };
const KINDS: [string, string][] = [['webhook', 'Any tool (webhook)'], ['form', 'Website form'], ['widget', 'Website button'], ['meta_lead_ads', 'Facebook / Instagram lead ads'], ['indiamart', 'IndiaMART'], ['justdial', 'JustDial'], ['shopify', 'Shopify'], ['woocommerce', 'WooCommerce'], ['google_sheets', 'Google Sheets'], ['other', 'Other']];
const KIND_LABEL: Record<string, string> = { ...Object.fromEntries(KINDS), form: 'Hosted form', import: 'Imported list', ctwa: 'Click-to-WhatsApp ads', widget: 'Website button', manual: 'Added by hand' };

const ago = (iso: string) => { const s = (Date.now() - new Date(iso).getTime()) / 1000; if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }); };
const wa = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`;

export function LeadsView({ initial, canManage, canWrite }: { initial: LeadsData; canManage: boolean; canWrite: boolean }) {
  const [tab, setTab] = useState<'inbox' | 'channels' | 'sources'>('inbox');
  const [data, setData] = useState(initial);
  const [filter, setFilter] = useState<{ status?: string; sourceId?: string; ownerId?: string; q?: string; mine?: boolean; page: number }>({ page: 1 });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<LeadRow | null>(null);
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback((f: typeof filter) => { start(async () => { setData(await listLeads(f)); setSel(new Set()); }); }, []);
  const apply = (patch: Partial<typeof filter>) => { const f = { ...filter, page: 1, ...patch }; setFilter(f); load(f); };
  useEffect(() => { const t = setTimeout(() => { if (q !== (filter.q ?? '')) apply({ q }); }, 350); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = Object.values(data.counts).reduce((a, b) => a + b, 0);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const allOn = data.rows.length > 0 && data.rows.every((r) => sel.has(r.id));
  const bulk = (patch: { status?: string; ownerId?: string | null }) => start(async () => { const r = await bulkUpdateLeads([...sel], patch); setMsg(r.ok ? `${r.data.changed} updated.` : r.error); setData(await listLeads(filter)); setSel(new Set()); });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-2xl font-extrabold">Leads</h2><p className="text-sm text-muted">Everyone who asked to hear from you, from every place you advertise.</p></div>
        <div className="flex rounded-xl border border-line bg-card p-1 text-sm font-semibold">
          {(['inbox', 'channels', 'sources'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={cn('min-h-9 rounded-lg px-3 sm:px-4', tab === t ? 'grad-bg text-white' : 'text-muted hover:text-ink')}>{t === 'inbox' ? `Inbox${total ? ` (${total})` : ''}` : t === 'channels' ? 'Get leads' : 'Connect tools'}</button>)}
        </div>
      </div>

      {tab === 'channels' ? <ChannelsPanel canManage={canManage} /> : tab === 'sources' ? <SourcesPanel canManage={canManage} onChanged={() => load(filter)} /> : (
        <>
          <div className="flex flex-wrap gap-2">
            <Chip on={!filter.status} onClick={() => apply({ status: undefined })}>All <b>{total}</b></Chip>
            {LEAD_STATUSES.map((s) => <Chip key={s} on={filter.status === s} onClick={() => apply({ status: filter.status === s ? undefined : s })}>{STATUS_LABEL[s]} <b>{data.counts[s] ?? 0}</b></Chip>)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-52 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><Input className="pl-9" placeholder="Search name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <Select className="w-[calc(50%-.25rem)] sm:w-auto" value={filter.sourceId ?? ''} onChange={(e) => apply({ sourceId: e.target.value || undefined })}><option value="">All sources</option>{data.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
            <Select className="w-[calc(50%-.25rem)] sm:w-auto" value={filter.mine ? '__me' : filter.ownerId ?? ''} onChange={(e) => apply(e.target.value === '__me' ? { mine: true, ownerId: undefined } : { mine: false, ownerId: e.target.value || undefined })}><option value="">Anyone</option><option value="__me">Mine</option>{data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
          </div>

          {sel.size > 0 && canWrite ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand/30 bg-brand/5 p-2 text-sm">
              <b className="px-2">{sel.size} selected</b>
              <Select className="w-auto" defaultValue="" onChange={(e) => { if (e.target.value) bulk({ status: e.target.value }); e.target.value = ''; }}><option value="">Set status…</option>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select>
              <Select className="w-auto" defaultValue="" onChange={(e) => { if (e.target.value) bulk({ ownerId: e.target.value === '__none' ? null : e.target.value }); e.target.value = ''; }}><option value="">Assign to…</option><option value="__none">Unassigned</option>{data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
            </div>
          ) : null}
          {msg ? <p className="text-sm text-emerald-700">{msg}</p> : null}

          {data.rows.length === 0 ? <Empty total={total} onSources={() => setTab('channels')} /> : (
            <div className="card overflow-hidden">
              <div className="hidden grid-cols-[2rem_1.6fr_1.1fr_1fr_1fr_6rem] gap-3 border-b border-line px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted md:grid">
                <input type="checkbox" aria-label="Select all" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(data.rows.map((r) => r.id)))} /><span>Lead</span><span>Source</span><span>Owner</span><span>Status</span><span className="text-right">When</span>
              </div>
              <ul className={cn('divide-y divide-line', busy && 'opacity-60')}>
                {data.rows.map((r) => (
                  <li key={r.id} className="grid cursor-pointer grid-cols-[2rem_1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-ink/[0.03] md:grid-cols-[2rem_1.6fr_1.1fr_1fr_1fr_6rem]" onClick={() => setOpen(r)}>
                    <input type="checkbox" aria-label={`Select ${r.name ?? r.phone}`} checked={sel.has(r.id)} onClick={(e) => e.stopPropagation()} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />
                    <div className="min-w-0"><p className="truncate font-semibold">{r.name ?? 'No name'}{r.submissions > 1 ? <span className="ml-2 rounded bg-ink/10 px-1.5 py-0.5 text-[10px] font-bold">×{r.submissions}</span> : null}</p><p className="truncate text-xs text-muted">{r.phone}{r.email ? ` · ${r.email}` : ''}</p></div>
                    <span className={cn('justify-self-end rounded-full px-2.5 py-0.5 text-xs font-semibold md:hidden', STATUS_STYLE[r.status])}>{STATUS_LABEL[r.status]}</span>
                    <p className="col-start-2 truncate text-xs text-muted md:col-start-auto md:text-sm">{r.sourceName ?? 'Deleted source'}{r.utmCampaign ? ` · ${r.utmCampaign}` : ''}</p>
                    <p className="hidden truncate text-sm md:block">{r.ownerName ?? <span className="text-muted">Unassigned</span>}</p>
                    <span className={cn('hidden w-fit rounded-full px-2.5 py-0.5 text-xs font-semibold md:inline', STATUS_STYLE[r.status])}>{STATUS_LABEL[r.status]}</span>
                    <p className="col-start-3 text-right text-xs text-muted md:col-start-auto">{ago(r.createdAt)}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {pages > 1 ? (
            <div className="flex items-center justify-between text-sm"><span className="text-muted">{data.total} leads · page {data.page} of {pages}</span>
              <span className="flex gap-2"><Button variant="outline" size="sm" disabled={data.page <= 1 || busy} onClick={() => { const f = { ...filter, page: data.page - 1 }; setFilter(f); load(f); }}>Previous</Button><Button variant="outline" size="sm" disabled={data.page >= pages || busy} onClick={() => { const f = { ...filter, page: data.page + 1 }; setFilter(f); load(f); }}>Next</Button></span></div>
          ) : null}
        </>
      )}
      {open ? <LeadPanel lead={open} members={data.members} canWrite={canWrite} onClose={() => setOpen(null)} onSaved={async () => { setData(await listLeads(filter)); }} /> : null}
    </div>
  );
}

const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button onClick={onClick} className={cn('min-h-9 rounded-full border px-3.5 text-sm font-medium', on ? 'border-brand bg-brand/10 text-brand' : 'border-line bg-card text-muted hover:text-ink')}>{children}</button>
);

function Empty({ total, onSources }: { total: number; onSources: () => void }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="grid size-12 place-items-center rounded-2xl grad-bg text-white"><UserCheck className="size-6" /></div>
      <h3 className="font-display text-lg font-bold">{total ? 'No leads match these filters' : 'No leads yet'}</h3>
      <p className="max-w-md text-sm text-muted">{total ? 'Clear a filter to see more.' : 'Connect a form, an ad, a website or any tool that can send a webhook. New leads land here the moment someone fills it in.'}</p>
      {!total ? <Button onClick={onSources}>Get your first lead</Button> : null}
    </div>
  );
}

function LeadPanel({ lead, members, canWrite, onClose, onSaved }: { lead: LeadRow; members: { id: string; name: string }[]; canWrite: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [status, setStatus] = useState(lead.status);
  const [owner, setOwner] = useState(lead.ownerId ?? '');
  const [value, setValue] = useState(lead.valueRupees ? String(lead.valueRupees) : '');
  const [note, setNote] = useState(lead.note ?? '');
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  const [events, setEvents] = useState<Awaited<ReturnType<typeof loadLeadEvents>>>([]);
  const [busy, start] = useTransition();
  useEffect(() => { void loadLeadEvents(lead.id).then(setEvents); }, [lead.id, saved]);
  const save = () => start(async () => {
    setErr(''); setSaved(false);
    const v = value.trim() === '' ? 0 : Number(value.replace(/,/g, ''));
    if (!Number.isFinite(v) || v < 0) { setErr('Enter the deal value as a number.'); return; }
    const r = await updateLead(lead.id, { status: status as 'new', ownerId: owner || null, valueRupees: v, note: note.trim() || null });
    if (!r.ok) { setErr(r.error); return; }
    setSaved(true); await onSaved();
  });
  const fields = Object.entries(lead.fields);
  return (
    <Modal open onClose={onClose} title={lead.name ?? lead.phone}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <a className="rounded-lg border border-line px-3 py-2 font-semibold hover:border-brand" href={wa(lead.phone)} target="_blank" rel="noreferrer">Open in WhatsApp</a>
          <a className="rounded-lg border border-line px-3 py-2 font-semibold hover:border-brand" href={`tel:${lead.phone}`}>{lead.phone}</a>
          <span className={cn('ml-auto text-xs font-semibold', CONSENT_STYLE[lead.consent])}>{CONSENT_LABEL[lead.consent] ?? lead.consent}</span>
        </div>
        {lead.consent !== 'allowed' ? <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">{lead.consent === 'stopped' ? 'This person opted out. Do not send them offers.' : 'This person has not agreed to marketing messages. You can reply if they message you first; offers and campaigns skip them until they opt in.'}</p> : null}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Item k="Source" v={lead.sourceName ?? 'Deleted source'} /><Item k="Received" v={new Date(lead.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })} />
          {lead.email ? <Item k="Email" v={lead.email} /> : null}{lead.utmSource ? <Item k="Campaign" v={[lead.utmSource, lead.utmCampaign].filter(Boolean).join(' / ')} /> : null}
          {lead.sourceUrl ? <Item k="Page" v={lead.sourceUrl} /> : null}{lead.submissions > 1 ? <Item k="Submitted" v={`${lead.submissions} times`} /> : null}
          {fields.map(([k, v]) => <Item key={k} k={k.replace(/_/g, ' ')} v={v} />)}
        </dl>
        {canWrite ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select></Field>
            <Field label="Owner"><Select value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
            <Field label="Deal value (₹)"><Input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" /></Field>
            <div className="sm:col-span-2"><Field label="Note"><Textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did they ask for? What is next?" /></Field></div>
            {err ? <div className="sm:col-span-2"><FormError>{err}</FormError></div> : null}
            <div className="flex items-center gap-3 sm:col-span-2"><Button onClick={save} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}Save changes</Button>{saved ? <span className="flex items-center gap-1 text-sm text-emerald-700"><Check className="size-4" />Saved</span> : null}</div>
          </div>
        ) : <p className="text-sm text-muted">Your role can view leads but not change them.</p>}
        {events.length ? (
          <div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">History</h4>
            <ul className="flex max-h-40 flex-col gap-1 overflow-auto text-xs text-muted">{events.map((e, i) => <li key={i}><b className="text-ink">{describe(e.kind, e.data)}</b> · {ago(e.at)}{e.by ? ` · ${e.by}` : ''}</li>)}</ul></div>
        ) : null}
      </div>
    </Modal>
  );
}
const Item = ({ k, v }: { k: string; v: string }) => <div className="min-w-0"><dt className="text-xs capitalize text-muted">{k}</dt><dd className="break-words font-medium">{v}</dd></div>;
function describe(kind: string, d: Record<string, unknown>) {
  switch (kind) {
    case 'created': return `Lead came in from ${d.source ?? 'a source'}`;
    case 'resubmitted': return 'Submitted again';
    case 'assigned': return d.how === 'round_robin' ? 'Assigned automatically' : 'Owner changed';
    case 'status': return `Status: ${STATUS_LABEL[String(d.from)] ?? d.from ?? '—'} → ${STATUS_LABEL[String(d.to)] ?? d.to}`;
    case 'value': return `Deal value set to ₹${Number(d.rupees ?? 0).toLocaleString('en-IN')}`;
    case 'note': return 'Note updated';
    default: return kind;
  }
}

/* ------------------------------------------------------------------ sources */
function SourcesPanel({ canManage, onChanged }: { canManage: boolean; onChanged: () => void }) {
  const [d, setD] = useState<SourcesData | null>(null);
  const [edit, setEdit] = useState<SourceRow | 'new' | null>(null);
  const [reveal, setReveal] = useState<{ name: string; publicId: string; secret: string } | null>(null);
  const [help, setHelp] = useState<SourceRow | null>(null);
  const [msg, setMsg] = useState('');
  const refresh = useCallback(() => listSources().then(setD), []);
  useEffect(() => { void refresh(); }, [refresh]);
  if (!d) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <div className="flex flex-col gap-4">
      {!d.base ? <div className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><p>The public address for lead capture is not set (<code>WORKER_PUBLIC_URL</code>). You can create sources now, but the links below will not work until it is.</p></div> : null}
      {msg ? <p className="text-sm text-emerald-700">{msg}</p> : null}
      <div className="flex items-center justify-between"><p className="text-sm text-muted">Each source gets its own address and key, so you can see which ad or form brings the best leads.</p>{canManage ? <Button onClick={() => setEdit('new')}><Plus className="size-4" />Add source</Button> : null}</div>
      {d.sources.length === 0 ? <div className="card px-6 py-10 text-center text-sm text-muted">No sources yet. Add one to get a lead address you can paste into any form, ad platform or tool.</div> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {d.sources.map((s) => (
            <li key={s.id} className={cn('card flex min-w-0 flex-col gap-2 overflow-hidden p-4', !s.enabled && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2"><div className="min-w-0 flex-1"><h3 className="truncate font-display font-bold">{s.name}</h3><p className="text-xs text-muted">{KIND_LABEL[s.kind] ?? s.kind}</p></div>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold', s.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700')}>{s.enabled ? 'On' : 'Off'}</span></div>
              <p className="text-sm"><b>{s.leadCount}</b> leads{s.lastLeadAt ? <span className="text-muted"> · last {ago(s.lastLeadAt)}</span> : <span className="text-muted"> · none yet</span>}</p>
              <p className={cn('break-words text-xs', s.consentMode === 'none' ? 'text-amber-700' : 'text-emerald-700')}>{s.consentMode === 'none' ? 'Leads are reply-only (no offers) until they opt in' : s.consentMode === 'field' ? 'Offers allowed when the form’s consent box is ticked' : 'Offers allowed: you confirmed the form asks for WhatsApp opt-in'}</p>
              {s.rejects7d > 0 ? <p className="text-xs text-rose-700">{s.rejects7d} refused in the last 7 days</p> : null}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setHelp(s)}>How to connect</Button>
                {canManage ? <><Button size="sm" variant="outline" onClick={() => setEdit(s)}>Edit</Button>
                  <Button size="icon" variant="ghost" className="size-10" aria-label={s.enabled ? 'Switch off' : 'Switch on'} onClick={async () => { const r = await setSourceEnabled(s.id, !s.enabled); setMsg(r.ok ? '' : r.error); await refresh(); }}><Power className="size-4" /></Button>
                  <Button size="icon" variant="ghost" className="size-10" aria-label="New key" onClick={async () => { if (!confirm('Make a new key? The old key stops working immediately.')) return; const r = await rotateSourceKey(s.id); if (r.ok) setReveal({ name: s.name, publicId: s.publicId, secret: r.data.secret }); else setMsg(r.error); await refresh(); }}><KeyRound className="size-4" /></Button>
                  <Button size="icon" variant="ghost" className="size-10" aria-label="Delete" onClick={async () => { if (!confirm(`Delete “${s.name}”? Its leads and contacts are kept.`)) return; const r = await deleteSource(s.id); setMsg(r.ok ? 'Source deleted. Leads kept.' : r.error); await refresh(); onChanged(); }}><Trash2 className="size-4" /></Button></> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {edit ? <SourceForm data={d} source={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={async (secretInfo) => { setEdit(null); await refresh(); if (secretInfo) setReveal(secretInfo); }} /> : null}
      {reveal ? <Reveal base={d.base} info={reveal} onClose={() => setReveal(null)} /> : null}
      {help ? <HelpModal base={d.base} s={help} onClose={() => setHelp(null)} /> : null}
    </div>
  );
}

function SourceForm({ data, source, onClose, onDone }: { data: SourcesData; source: SourceRow | null; onClose: () => void; onDone: (secret?: { name: string; publicId: string; secret: string }) => void }) {
  const [name, setName] = useState(source?.name ?? '');
  const [kind, setKind] = useState(source?.kind ?? 'webhook');
  const [mode, setMode] = useState(source?.consentMode ?? 'none');
  const [attest, setAttest] = useState(false);
  const [tags, setTags] = useState((source?.tags ?? []).join(', '));
  const [assign, setAssign] = useState<string[]>(source?.assignUserIds ?? []);
  const [group, setGroup] = useState(source?.groupId ?? '');
  const [fm, setFm] = useState<Record<string, string>>(source?.fieldMap ?? {});
  const [err, setErr] = useState('');
  const [busy, start] = useTransition();
  const save = () => start(async () => {
    setErr('');
    const input = { name, kind: kind as 'webhook', consentMode: mode as 'none', tags: tags.split(',').map((t) => t.trim()).filter(Boolean), assignUserIds: assign, groupId: group || null, fieldMap: Object.fromEntries(Object.entries(fm).filter(([, v]) => v.trim())) as Record<'phone', string> };
    if (source) { const r = await updateSource(source.id, input, attest); if (!r.ok) { setErr(r.error); return; } onDone(); }
    else { const r = await createSource(input, attest); if (!r.ok) { setErr(r.error); return; } onDone({ name, publicId: r.data.publicId, secret: r.data.secret }); }
  });
  return (
    <Modal open onClose={onClose} title={source ? 'Edit lead source' : 'Add a lead source'} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" hint="For example: Diwali Facebook ad"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
        <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <div className="sm:col-span-2"><Field label="Can you send offers to these people?" hint="A lead is not permission to send marketing. Choose honestly: offers to people who did not agree can get your WhatsApp number restricted.">
          <Select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="none">No. Treat them as reply-only until they agree</option>
            <option value="field">Only when the form sends a ticked consent box</option>
            <option value="attested">Yes. My form clearly asks for WhatsApp opt-in</option>
          </Select></Field></div>
        {mode === 'attested' && source?.consentMode !== 'attested' ? <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2"><input type="checkbox" className="mt-1" checked={attest} onChange={(e) => setAttest(e.target.checked)} /><span>I confirm the form or ad shows a clear message like “I agree to receive WhatsApp messages and offers”, and I understand every lead from this source will be marked as having agreed.</span></label> : null}
        <Field label="Tags to add" hint="Comma separated"><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="facebook, diwali" /></Field>
        <Field label="Add to group"><Select value={group} onChange={(e) => setGroup(e.target.value)}><option value="">None</option>{data.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></Field>
        <div className="sm:col-span-2"><Field label="Share new leads between (round robin)" hint="Leave empty to keep leads unassigned.">
          <div className="flex flex-wrap gap-2">{data.members.map((m) => <label key={m.id} className={cn('flex min-h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm', assign.includes(m.id) ? 'border-brand bg-brand/10' : 'border-line')}><input type="checkbox" className="hidden" checked={assign.includes(m.id)} onChange={() => setAssign((a) => (a.includes(m.id) ? a.filter((x) => x !== m.id) : [...a, m.id]))} />{m.name}</label>)}</div></Field></div>
        <details className="sm:col-span-2"><summary className="cursor-pointer text-sm font-semibold text-muted">Field names (only if the other tool uses unusual names)</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">{(['phone', 'name', 'email', 'consent'] as const).map((k) => <Field key={k} label={`${k[0]!.toUpperCase()}${k.slice(1)} field`}><Input value={fm[k] ?? ''} onChange={(e) => setFm({ ...fm, [k]: e.target.value })} placeholder="Auto-detected" /></Field>)}</div></details>
        {err ? <div className="sm:col-span-2"><FormError>{err}</FormError></div> : null}
        <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}{source ? 'Save' : 'Create source'}</Button></div>
      </div>
    </Modal>
  );
}

function useCopy() { const [c, setC] = useState(''); return { c, copy: async (id: string, t: string) => { await navigator.clipboard.writeText(t).catch(() => undefined); setC(id); setTimeout(() => setC(''), 1500); } }; }
function Code({ id, text, copy, c }: { id: string; text: string; copy: (id: string, t: string) => void; c: string }) {
  return <div className="relative"><pre className="max-h-48 overflow-auto rounded-lg bg-slate-900 p-3 pr-12 text-xs text-slate-100">{text}</pre><button aria-label="Copy" onClick={() => copy(id, text)} className="absolute right-2 top-2 grid size-8 place-items-center rounded-md bg-white/10 text-white hover:bg-white/20">{c === id ? <Check className="size-4" /> : <Copy className="size-4" />}</button></div>;
}

function Reveal({ base, info, onClose }: { base: string | null; info: { name: string; publicId: string; secret: string }; onClose: () => void }) {
  const { c, copy } = useCopy();
  const url = `${base ?? 'https://YOUR-WORKER-ADDRESS'}/leads/${info.publicId}`;
  return (
    <Modal open onClose={onClose} title="Save this key now">
      <div className="flex flex-col gap-3 text-sm">
        <p className="rounded-lg bg-amber-50 p-3 text-amber-900">This key is shown <b>once</b>. We store only a scrambled copy, so we cannot show it again. If you lose it, make a new key.</p>
        <Field label="Address (POST)"><Code id="u" text={url} copy={copy} c={c} /></Field>
        <Field label="Key"><Code id="k" text={info.secret} copy={copy} c={c} /></Field>
        <Button onClick={onClose}>I have saved it</Button>
      </div>
    </Modal>
  );
}

function HelpModal({ base, s, onClose }: { base: string | null; s: SourceRow; onClose: () => void }) {
  const { c, copy } = useCopy();
  const [rej, setRej] = useState<Awaited<ReturnType<typeof rejectsFor>>>([]);
  useEffect(() => { void rejectsFor(s.id).then(setRej); }, [s.id]);
  const url = `${base ?? 'https://YOUR-WORKER-ADDRESS'}/leads/${s.publicId}`;
  const curl = `curl -X POST '${url}' \\\n  -H 'X-Lead-Key: YOUR_KEY' -H 'Content-Type: application/json' \\\n  -d '{"name":"Asha Verma","phone":"98765 43210","email":"asha@example.com","utm_source":"facebook"}'`;
  const html = `<form action="${url}?key=YOUR_KEY" method="post">\n  <input name="name" placeholder="Your name" required>\n  <input name="phone" placeholder="WhatsApp number" required>\n  <label><input type="checkbox" name="whatsapp_consent" value="yes">\n    I agree to receive WhatsApp messages and offers</label>\n  <button>Send</button>\n</form>`;
  return (
    <Modal open onClose={onClose} title={`Connect “${s.name}”`} wide>
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-muted">Send a POST with the person’s details. JSON and normal form posts both work, and common field names (phone, mobile, name, email, utm_*) are detected automatically. Your key is only shown when it is created; use “New key” if you lost it.</p>
        <Field label="Address"><Code id="u" text={url} copy={copy} c={c} /></Field>
        <Field label="Try it from a terminal"><Code id="c" text={curl} copy={copy} c={c} /></Field>
        <Field label="Or paste this form into your website" hint="The checkbox is what lets you send offers later. Only add it if you really show that wording."><Code id="h" text={html} copy={copy} c={c} /></Field>
        <p className="text-xs text-muted">Zapier, Make, n8n, Google Forms (Apps Script), Typeform, Tally, Wix and Webflow can all post to this address. Put the key in a header named <code>X-Lead-Key</code>, or add <code>?key=…</code> if the tool cannot set headers.</p>
        {rej.length ? <div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Recently refused</h4><ul className="flex flex-col gap-1 text-xs">{rej.map((r, i) => <li key={i} className="text-rose-700"><b>{r.reason.replace(/_/g, ' ')}</b>{r.detail ? `: ${r.detail}` : ''} · {ago(r.at)}</li>)}</ul></div> : null}
      </div>
    </Modal>
  );
}
