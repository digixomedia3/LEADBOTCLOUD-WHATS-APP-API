'use client';

import { useState, useTransition } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { deleteQuickReply, listQuickReplies, saveQuickReply, updateQuickReply } from '@/app/(app)/chats/actions';

type QR = { id: string; shortcut: string; body: string };

export function QuickRepliesView({ initial, canEdit }: { initial: QR[]; canEdit: boolean }) {
  const [rows, setRows] = useState(initial);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<QR | 'new' | null>(null);
  const [shortcut, setShortcut] = useState('');
  const [body, setBody] = useState('');
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const reload = async () => setRows(await listQuickReplies());
  const open = (v: QR | 'new') => { setEdit(v); setErr(''); setShortcut(v === 'new' ? '' : v.shortcut); setBody(v === 'new' ? '' : v.body); };
  const shown = rows.filter((r) => `${r.shortcut} ${r.body}`.toLowerCase().includes(q.toLowerCase()));

  const submit = () => start(async () => {
    const r = edit === 'new' ? await saveQuickReply({ shortcut, body }) : await updateQuickReply({ id: (edit as QR).id, body });
    if (!r.ok) { setErr(r.error); return; }
    setEdit(null); await reload();
  });
  const remove = (r: QR) => { if (!confirm(`Delete /${r.shortcut}?`)) return; start(async () => { await deleteQuickReply(r.id); await reload(); }); };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-2xl font-extrabold">Quick replies</h2><p className="text-sm text-muted">Saved answers for your team. In a chat, type <code className="rounded bg-line px-1">/</code> and the shortcut.</p></div>
        {canEdit ? <Button onClick={() => open('new')}><Plus className="size-4" />New quick reply</Button> : null}
      </div>
      <Input placeholder="Search shortcuts and text" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search quick replies" className="max-w-md" />
      {shown.length === 0 ? (
        <div className="card p-8 text-center text-sm text-muted">{rows.length === 0 ? (canEdit ? 'No quick replies yet. Add the answers you type most: prices, address, timings.' : 'No quick replies yet. Ask an admin to add some.') : 'Nothing matches that search.'}</div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {shown.map((r) => (
            <li key={r.id} className="card flex flex-col gap-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-sm font-bold text-brand">/{r.shortcut}</span>
                {canEdit ? <div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => open(r)} aria-label={`Edit ${r.shortcut}`}><Pencil className="size-4" /></Button><Button variant="ghost" size="sm" onClick={() => remove(r)} aria-label={`Delete ${r.shortcut}`}><Trash2 className="size-4" /></Button></div> : null}
              </div>
              <p className="whitespace-pre-wrap break-words text-sm">{r.body}</p>
            </li>
          ))}
        </ul>
      )}
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit === 'new' ? 'New quick reply' : 'Edit quick reply'}>
        <div className="flex flex-col gap-3">
          <Field label="Shortcut" hint="Lowercase letters, numbers, underscores. Cannot be changed later.">
            <Input value={shortcut} disabled={edit !== 'new'} maxLength={30} onChange={(e) => setShortcut(e.target.value.toLowerCase())} placeholder="price_list" />
          </Field>
          <Field label="Message" hint={`${body.length}/1000`}><Textarea rows={5} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          <FormError>{err}</FormError>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={submit} disabled={pending || !body.trim() || (edit === 'new' && !shortcut)}>Save</Button></div>
        </div>
      </Modal>
    </div>
  );
}
