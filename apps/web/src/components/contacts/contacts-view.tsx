'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Download, FolderPlus, Loader2, Pencil, Plus, Search, Tag, Trash2, Upload, UserPlus, Users, X } from 'lucide-react';
import { formatPhone } from '@lbc/shared';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { AddContactDialog } from '@/components/contacts/add-contact-dialog';
import { ImportWizard } from '@/components/contacts/import-wizard';
import { bulkAction, createGroup, deleteGroup, exportContacts, listContacts, renameGroup, type BulkAction, type ContactRow, type GroupRow } from '@/app/(app)/contacts/actions';
import { startConversation } from '@/app/(app)/chats/actions';
import { cn } from '@/lib/utils';

type Consent = 'all' | 'allowed' | 'stopped' | 'unknown';
interface Summary { total: number; allowed: number; stopped: number; unknown: number; limit: number; tags: { tag: string; n: number }[] }
interface Initial { rows: ContactRow[]; total: number; page: number; pageSize: number }

const badge = { allowed: ['Opted in', 'bg-brand/15 text-brand'], stopped: ['Opted out', 'bg-rose/15 text-rose'], unknown: ['No record', 'bg-amber/15 text-amber'] } as const;

export function ContactsView({ initial, summary, groups: initialGroups, canManage, canWrite }: { initial: Initial; summary: Summary; groups: GroupRow[]; canManage: boolean; canWrite: boolean }) {
  const [data, setData] = useState(initial);
  const [sum, setSum] = useState(summary);
  const [groups, setGroups] = useState(initialGroups);
  const [q, setQ] = useState('');
  const [consent, setConsent_] = useState<Consent>('all');
  const [group, setGroup] = useState('');
  const [tag, setTag] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [bulkMenu, setBulkMenu] = useState(false);
  const [tagPrompt, setTagPrompt] = useState<null | 'addTag' | 'removeTag'>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const load = useCallback(async (over?: Partial<{ q: string; consent: Consent; group: string; tag: string; page: number }>) => {
    setLoading(true);
    const p = { q, consent, group, tag, page, ...over };
    const r = await listContacts({ q: p.q, consent: p.consent, group: p.group || undefined, tag: p.tag || undefined, page: p.page });
    setData(r); setLoading(false);
  }, [q, consent, group, tag, page]);

  // Debounced reload on search / filters.
  useEffect(() => {
    const t = setTimeout(() => { void load({ page: 1 }); setPage(1); setSel(new Set()); }, q ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, consent, group, tag]);

  async function refreshAll(message?: string) {
    const { contactSummary, listGroups } = await import('@/app/(app)/contacts/actions');
    const [s, g] = await Promise.all([contactSummary(), listGroups()]);
    setSum(s); setGroups(g); await load(); setSel(new Set());
    if (message) flash(message);
  }
  function flash(m: string) { setToast(m); setTimeout(() => setToast(''), 3500); }

  const allOn = data.rows.length > 0 && data.rows.every((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const usedPct = Math.min(100, Math.round((sum.total / sum.limit) * 100));

  function run(a: BulkAction, done: string) {
    start(async () => {
      const r = await bulkAction([...sel], a);
      setBulkMenu(false); setTagPrompt(null);
      if (!r.ok) { flash(r.error); return; }
      await refreshAll(`${done} (${r.data.affected})`);
    });
  }

  async function exportCsv(ids?: string[]) {
    const r = await exportContacts({ ids, group: group || undefined });
    if (!r.ok) { flash(r.error); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + r.data.csv], { type: 'text/csv;charset=utf-8' })); a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
    flash(`Exported ${r.data.count} contacts.`);
  }

  const tabs: { id: Consent; label: string; n: number }[] = useMemo(() => [
    { id: 'all', label: 'All', n: sum.total }, { id: 'allowed', label: 'Opted in', n: sum.allowed }, { id: 'stopped', label: 'Opted out', n: sum.stopped }, { id: 'unknown', label: 'No record', n: sum.unknown },
  ], [sum]);

  return (
    <div className="flex flex-col gap-5">
      {/* Header + actions */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-extrabold">Contacts</h2>
          <p className="text-sm text-muted"><strong className="text-ink tabular">{sum.total.toLocaleString('en-IN')}</strong> of {sum.limit.toLocaleString('en-IN')} on your plan</p>
          <div className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-line"><div className="grad-bg h-full rounded-full" style={{ width: `${usedPct}%` }} /></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite ? <Button variant="outline" onClick={() => setAddOpen(true)}><UserPlus className="size-4" />Add contact</Button> : null}
          {canManage ? <Button onClick={() => setImportOpen(true)}><Upload className="size-4" />Import CSV</Button> : null}
          {canManage ? <Button variant="outline" onClick={() => exportCsv()}><Download className="size-4" />Export</Button> : null}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* Groups rail */}
        <aside className="card h-fit p-3" aria-label="Groups">
          <div className="mb-1 flex items-center justify-between px-2"><p className="text-xs font-semibold uppercase tracking-wide text-muted">Groups</p>{canManage ? <button onClick={() => setGroupsOpen(true)} aria-label="Manage groups" className="flex size-9 items-center justify-center rounded-lg hover:bg-ink/5"><Pencil className="size-4" /></button> : null}</div>
          <ul className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            <li><button onClick={() => setGroup('')} className={cn('flex min-h-11 w-full shrink-0 items-center justify-between gap-3 rounded-xl px-3 text-sm font-medium', !group ? 'bg-brand/10 text-brand' : 'hover:bg-ink/5')}><span className="flex items-center gap-2"><Users className="size-4" />Everyone</span><span className="tabular text-xs text-muted">{sum.total}</span></button></li>
            {groups.map((g) => (
              <li key={g.id}><button onClick={() => setGroup(g.id)} className={cn('flex min-h-11 w-full shrink-0 items-center justify-between gap-3 rounded-xl px-3 text-sm font-medium', group === g.id ? 'bg-brand/10 text-brand' : 'hover:bg-ink/5')}><span className="truncate">{g.name}</span><span className="tabular text-xs text-muted">{g.count}</span></button></li>
            ))}
            {canManage ? <li><button onClick={() => setGroupsOpen(true)} className="flex min-h-11 w-full shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-brand hover:bg-brand/10"><FolderPlus className="size-4" />New group</button></li> : null}
          </ul>
          {sum.tags.length ? (
            <div className="mt-3 border-t border-line pt-3"><p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted">Tags</p>
              <div className="flex flex-wrap gap-1.5 px-1">{sum.tags.slice(0, 12).map((t) => <button key={t.tag} onClick={() => setTag(tag === t.tag ? '' : t.tag)} className={cn('min-h-9 rounded-full border px-3 text-xs font-semibold', tag === t.tag ? 'border-brand bg-brand/10 text-brand' : 'border-line hover:border-brand/50')}>{t.tag} · {t.n}</button>)}</div></div>
          ) : null}
        </aside>

        {/* Table */}
        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-52 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search contacts" placeholder="Search name, number or email" className="min-h-11 w-full rounded-xl border border-line bg-card pl-9 pr-9 text-sm focus:border-brand" />
              {q ? <button onClick={() => setQ('')} aria-label="Clear search" className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg hover:bg-ink/5"><X className="size-4" /></button> : null}
            </div>
            {loading ? <Loader2 className="size-5 animate-spin text-muted" aria-label="Loading" /> : null}
          </div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" role="tablist">
            {tabs.map((t) => <button key={t.id} role="tab" aria-selected={consent === t.id} onClick={() => setConsent_(t.id)} className={cn('min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold', consent === t.id ? 'grad-bg border-transparent text-white' : 'border-line bg-card text-muted')}>{t.label} <span className="opacity-80 tabular">{t.n}</span></button>)}
          </div>

          {sel.size > 0 && canManage ? (
            <div className="sticky top-20 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-brand/40 bg-card/95 px-4 py-2.5 shadow-lg backdrop-blur" role="toolbar" aria-label="Bulk actions">
              <span className="text-sm font-bold">{sel.size} selected</span>
              <div className="relative ml-auto">
                <Button size="sm" variant="soft" onClick={() => setBulkMenu((o) => !o)} aria-haspopup="menu" aria-expanded={bulkMenu} disabled={pending}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}Actions<ChevronDown className="size-4" /></Button>
                {bulkMenu ? (
                  <ul role="menu" className="card absolute right-0 z-20 mt-1 w-60 overflow-hidden p-1 text-sm [animation:pop_0.15s_ease-out]">
                    {groups.map((g) => <li key={g.id} role="none"><button role="menuitem" className="min-h-11 w-full rounded-lg px-3 text-left hover:bg-ink/5" onClick={() => run({ type: 'addToGroup', groupId: g.id }, `Added to ${g.name}`)}>Add to “{g.name}”</button></li>)}
                    {group ? <li role="none"><button role="menuitem" className="min-h-11 w-full rounded-lg px-3 text-left hover:bg-ink/5" onClick={() => run({ type: 'removeFromGroup', groupId: group }, 'Removed from group')}>Remove from this group</button></li> : null}
                    <li role="none"><button role="menuitem" className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left hover:bg-ink/5" onClick={() => { setBulkMenu(false); setTagPrompt('addTag'); }}><Tag className="size-4" />Add a tag</button></li>
                    <li role="none"><button role="menuitem" className="min-h-11 w-full rounded-lg px-3 text-left hover:bg-ink/5" onClick={() => { setBulkMenu(false); setTagPrompt('removeTag'); }}>Remove a tag</button></li>
                    <li role="none"><button role="menuitem" className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left hover:bg-ink/5" onClick={() => { setBulkMenu(false); void exportCsv([...sel]); }}><Download className="size-4" />Export selected</button></li>
                    <li role="none"><button role="menuitem" className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left font-semibold text-rose hover:bg-rose/10" onClick={() => { setBulkMenu(false); if (confirm(`Delete ${sel.size} contacts? This cannot be undone.`)) run({ type: 'delete' }, 'Deleted'); }}><Trash2 className="size-4" />Delete</button></li>
                  </ul>) : null}
              </div>
              <button onClick={() => setSel(new Set())} className="min-h-11 px-2 text-sm font-semibold text-muted">Clear</button>
            </div>
          ) : null}

          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[44rem] text-sm">
              <thead><tr className="border-b border-line bg-card2 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="w-12 px-4 py-3">{canManage ? <input type="checkbox" aria-label="Select all on this page" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(data.rows.map((r) => r.id)))} className="size-4 accent-[var(--brand)]" /> : null}</th>
                <th className="px-3 py-3">Name</th><th className="px-3 py-3">Phone</th><th className="px-3 py-3">Groups and tags</th><th className="px-3 py-3">Permission</th><th className="px-3 py-3">Added</th><th className="w-20 px-3 py-3"><span className="sr-only">Chat</span></th>
              </tr></thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-14 text-center">
                    <Users className="mx-auto mb-3 size-10 text-muted" />
                    <p className="font-semibold">{sum.total === 0 ? 'No contacts yet' : 'No contacts match'}</p>
                    <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{sum.total === 0 ? 'Add a customer or import a CSV to get started. Only add people who agreed to get your WhatsApp messages.' : 'Clear the search or change the filters.'}</p>
                    {sum.total === 0 && canManage ? <Button className="mt-4" onClick={() => setImportOpen(true)}><Upload className="size-4" />Import CSV</Button> : null}
                  </td></tr>
                ) : null}
                {data.rows.map((c) => {
                  const [bl, bc] = badge[c.consentStatus as keyof typeof badge] ?? badge.unknown;
                  return (
                    <tr key={c.id} className="border-b border-line last:border-0 hover:bg-ink/[0.03]">
                      <td className="px-4 py-3">{canManage ? <input type="checkbox" aria-label={`Select ${c.name ?? c.phone}`} checked={sel.has(c.id)} onChange={() => toggle(c.id)} className="size-4 accent-[var(--brand)]" /> : null}</td>
                      <td className="px-3 py-3 font-semibold">{c.name ?? <span className="font-normal text-muted">No name</span>}{c.email ? <span className="block text-xs font-normal text-muted">{c.email}</span> : null}</td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">{formatPhone(c.phone)}</td>
                      <td className="px-3 py-3"><div className="flex max-w-64 flex-wrap gap-1">{c.groups.map((g) => <span key={g} className="rounded-full bg-indigo/10 px-2 py-0.5 text-[11px] font-semibold text-indigo">{g}</span>)}{c.tags.map((t) => <span key={t} className="rounded-full bg-ink/5 px-2 py-0.5 text-[11px] font-medium">{t}</span>)}{!c.groups.length && !c.tags.length ? <span className="text-muted">-</span> : null}</div></td>
                      <td className="px-3 py-3"><span className={cn('rounded-full px-2.5 py-1 text-xs font-bold', bc)}>{bl}</span>{c.consentSource && c.consentStatus === 'allowed' ? <span className="block text-[11px] text-muted">{c.consentSource}</span> : null}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-muted">{new Date(c.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}</td>
                      <td className="px-3 py-3">{canWrite && c.consentStatus !== 'stopped' ? <button onClick={() => start(async () => { const r = await startConversation(c.id); if (r.ok) router.push('/chats'); else flash(r.error); })} className="min-h-11 rounded-lg px-3 text-xs font-bold text-brand hover:bg-brand/10">Chat</button> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-xs text-muted">
              <span>{data.total.toLocaleString('en-IN')} contacts</span>
              <span className="flex items-center gap-2">
                <button disabled={page <= 1} onClick={() => { setPage(page - 1); void load({ page: page - 1 }); }} className="min-h-11 rounded-lg border border-line px-3 font-semibold disabled:opacity-40">Previous</button>
                <span>Page {page} of {pages}</span>
                <button disabled={page >= pages} onClick={() => { setPage(page + 1); void load({ page: page + 1 }); }} className="min-h-11 rounded-lg border border-line px-3 font-semibold disabled:opacity-40">Next</button>
              </span>
            </div>
          </div>
        </section>
      </div>

      <AddContactDialog open={addOpen} onClose={() => setAddOpen(false)} groups={groups} onDone={(m) => { void refreshAll(m); }} />
      <ImportWizard open={importOpen} onClose={() => setImportOpen(false)} groups={groups} onDone={(m) => { void refreshAll(m); }} />
      <GroupsManager open={groupsOpen} onClose={() => setGroupsOpen(false)} groups={groups} onChanged={(m) => { void refreshAll(m); }} />
      <TagPrompt kind={tagPrompt} onClose={() => setTagPrompt(null)} onSubmit={(t) => run({ type: tagPrompt!, tag: t }, tagPrompt === 'addTag' ? 'Tag added' : 'Tag removed')} />
      {toast ? <div role="status" className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-bg shadow-xl md:bottom-8">{toast}</div> : null}
    </div>
  );
}

function TagPrompt({ kind, onClose, onSubmit }: { kind: null | 'addTag' | 'removeTag'; onClose: () => void; onSubmit: (t: string) => void }) {
  const [v, setV] = useState('');
  return (
    <Modal open={!!kind} onClose={() => { setV(''); onClose(); }} title={kind === 'addTag' ? 'Add a tag' : 'Remove a tag'}>
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onSubmit(v.trim()); setV(''); } }} className="flex flex-col gap-4">
        <Field label="Tag"><Input value={v} onChange={(e) => setV(e.target.value)} autoFocus maxLength={40} placeholder="premium" /></Field>
        <Button type="submit" disabled={!v.trim()}>{kind === 'addTag' ? 'Add tag' : 'Remove tag'}</Button>
      </form>
    </Modal>
  );
}

function GroupsManager({ open, onClose, groups, onChanged }: { open: boolean; onClose: () => void; groups: GroupRow[]; onChanged: (m: string) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState('');
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) => start(async () => { setError(''); const r = await fn(); if (!r.ok) setError(r.error ?? 'Something went wrong.'); else { onChanged(msg); setName(''); setEditing(null); } });
  return (
    <Modal open={open} onClose={onClose} title="Groups">
      <div className="flex flex-col gap-4">
        <FormError>{error}</FormError>
        <form onSubmit={(e) => { e.preventDefault(); act(() => createGroup(name), 'Group created.'); }} className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New group name" aria-label="New group name" maxLength={80} />
          <Button type="submit" disabled={pending || name.trim().length < 2}><Plus className="size-4" />Add</Button>
        </form>
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
          {groups.length === 0 ? <li className="p-5 text-center text-sm text-muted">No groups yet. Groups let you send a campaign to a set of people.</li> : null}
          {groups.map((g) => (
            <li key={g.id} className="flex items-center gap-2 p-2">
              {editing === g.id ? (
                <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); act(() => renameGroup(g.id, edit), 'Group renamed.'); }}>
                  <Input value={edit} onChange={(e) => setEdit(e.target.value)} aria-label="Group name" autoFocus maxLength={80} /><Button type="submit" size="sm" disabled={pending}>Save</Button>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1 px-2"><span className="block truncate font-semibold">{g.name}</span><span className="text-xs text-muted">{g.count} contacts</span></span>
                  <Button variant="ghost" size="icon" aria-label={`Rename ${g.name}`} onClick={() => { setEditing(g.id); setEdit(g.name); }}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Delete ${g.name}`} onClick={() => { if (confirm(`Delete the group “${g.name}”? The contacts stay in your list.`)) act(() => deleteGroup(g.id), 'Group deleted.'); }}><Trash2 className="size-4 text-rose" /></Button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
