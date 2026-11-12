'use client';

import { useState, useTransition } from 'react';
import { Bot, Loader2, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { deleteRule, listRules, saveRule, toggleRule, type RuleRow } from '@/app/(app)/automation/actions';
import { cn } from '@/lib/utils';

const KIND: Record<string, string> = { keyword: 'When a customer writes a keyword', welcome: 'First message from a new customer', away: 'Outside working hours' };
const IDEAS = [
  { name: 'Price enquiry', kind: 'keyword', keywords: ['price', 'cost', 'rate', 'fees'], reply: 'Thanks for asking. Our plans start from ₹499 a month. Reply with your name and we will share the full list.' },
  { name: 'Timings', kind: 'keyword', keywords: ['timing', 'time', 'open', 'address'], reply: 'We are open 6 AM to 10 PM, Monday to Saturday. Visit us any time.' },
  { name: 'Welcome', kind: 'welcome', keywords: [], reply: 'Hello and welcome. How can we help you today?' },
];

export function AutomationView({ initial, canEdit, plan }: { initial: RuleRow[]; canEdit: boolean; plan: string }) {
  const [rows, setRows] = useState(initial);
  const [edit, setEdit] = useState<null | Partial<RuleRow>>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const refresh = async () => setRows(await listRules());

  function save() {
    if (!edit) return;
    setError('');
    start(async () => {
      const r = await saveRule({ id: edit.id, name: edit.name ?? '', kind: (edit.kind ?? 'keyword') as 'keyword', keywords: edit.keywords ?? [], reply: edit.reply ?? '' });
      if (!r.ok) { setError(r.error); return; }
      setEdit(null); await refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h2 className="font-display text-2xl font-extrabold">Auto-replies</h2><p className="text-sm text-muted">Answer common questions instantly, day or night. {plan === 'free' ? 'Free plan: up to 3 rules.' : ''}</p></div>
        {canEdit ? <Button onClick={() => { setError(''); setEdit({ kind: 'keyword', keywords: [], name: '', reply: '' }); }}><Plus className="size-4" />New rule</Button> : null}
      </div>
      {rows.length === 0 ? (
        <div className="card p-8"><Bot className="mb-3 size-10 text-brand" /><h3 className="font-display text-lg font-bold">No rules yet</h3><p className="mb-5 text-sm text-muted">Start with one of these and edit the words.</p>
          <div className="grid gap-3 sm:grid-cols-3">{IDEAS.map((i) => <button key={i.name} disabled={!canEdit} onClick={() => { setError(''); setEdit(i); }} className="card card-hover p-4 text-left"><p className="font-semibold">{i.name}</p><p className="mt-1 line-clamp-3 text-sm text-muted">{i.reply}</p></button>)}</div></div>
      ) : (
        <ul className="grid gap-3">{rows.map((r) => (
          <li key={r.id} className="card flex flex-wrap items-start gap-4 p-4">
            <span className="grad-bg flex size-10 shrink-0 items-center justify-center rounded-xl text-white"><Zap className="size-5" /></span>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{r.name}</h3><span className="rounded-full bg-ink/5 px-2 py-0.5 text-[11px] font-semibold">{KIND[r.kind]}</span><span className="text-xs text-muted tabular">{r.hits} replies sent</span></div>
              {r.keywords.length ? <p className="mt-1 flex flex-wrap gap-1">{r.keywords.map((k) => <span key={k} className="rounded-full bg-indigo/10 px-2 py-0.5 text-xs font-semibold text-indigo">{k}</span>)}</p> : null}
              <p className="mt-2 rounded-xl bg-card2 p-3 text-sm">{r.reply}</p></div>
            {canEdit ? <div className="flex items-center gap-1">
              <button role="switch" aria-checked={r.active} aria-label={`${r.name} is ${r.active ? 'on' : 'off'}`} onClick={() => start(async () => { await toggleRule(r.id, !r.active); await refresh(); })} className={cn('relative h-7 w-12 rounded-full transition-colors', r.active ? 'bg-brand' : 'bg-line')}><span className={cn('absolute top-0.5 size-6 rounded-full bg-white shadow transition-all', r.active ? 'left-[1.4rem]' : 'left-0.5')} /></button>
              <Button variant="ghost" size="icon" aria-label={`Edit ${r.name}`} onClick={() => { setError(''); setEdit(r); }}><Pencil className="size-4" /></Button>
              <Button variant="ghost" size="icon" aria-label={`Delete ${r.name}`} onClick={() => { if (confirm(`Delete “${r.name}”?`)) start(async () => { await deleteRule(r.id); await refresh(); }); }}><Trash2 className="size-4 text-rose" /></Button></div> : null}
          </li>))}</ul>)}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit rule' : 'New rule'}>
        {edit ? <div className="flex flex-col gap-4">
          <FormError>{error}</FormError>
          <Field label="Rule name"><Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={80} autoFocus /></Field>
          <Field label="When"><Select value={edit.kind ?? 'keyword'} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          {(edit.kind ?? 'keyword') === 'keyword' ? <Field label="Keywords" hint="Separate with commas. The reply is sent if the message contains any of them."><Input value={(edit.keywords ?? []).join(', ')} onChange={(e) => setEdit({ ...edit, keywords: e.target.value.split(',').map((k) => k.trim()).filter(Boolean) })} placeholder="price, cost, fees" /></Field> : null}
          <Field label="Reply" hint={`${(edit.reply ?? '').length}/1000`}><Textarea rows={5} value={edit.reply ?? ''} onChange={(e) => setEdit({ ...edit, reply: e.target.value })} /></Field>
          <Button disabled={pending} onClick={save}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}Save rule</Button>
        </div> : null}
      </Modal>
    </div>
  );
}
