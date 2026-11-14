'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { AlertTriangle, CheckCircle2, Copy, FlaskConical, ImageIcon, Loader2, Plus, Send, Trash2, X, XCircle } from 'lucide-react';
import { MEDIA_LIMITS, checkHeaderMedia, explainRejection, lintTemplate, variablesIn, type Category } from '@lbc/shared';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { WaBubble } from '@/components/ui/wa-bubble';
import { deleteTemplate, duplicateTemplate, saveTemplate, simulateReview, submitTemplate, type DraftInput, type TemplateRow } from '@/app/(app)/templates/actions';
import { cn } from '@/lib/utils';

const CAT: Record<Category, { label: string; hint: string; price: string }> = {
  marketing: { label: 'Promotional', hint: 'Offers, news, reminders to renew', price: '≈ ₹0.86' },
  utility: { label: 'Updates', hint: 'Order, payment or booking updates the customer expects', price: '≈ ₹0.12' },
  authentication: { label: 'OTP', hint: 'One-time passwords', price: '≈ ₹0.12' },
};
const STATUS: Record<string, [string, string]> = { draft: ['Draft', 'bg-ink/10'], pending: ['In review', 'bg-amber/15 text-amber'], approved: ['Approved', 'bg-brand/15 text-brand'], rejected: ['Rejected', 'bg-rose/15 text-rose'], paused: ['Paused', 'bg-amber/15 text-amber'], disabled: ['Turned off', 'bg-rose/15 text-rose'] };
const QUALITY: Record<string, string> = { green: 'text-brand', yellow: 'text-amber', red: 'text-rose', unknown: 'text-muted' };

const STARTERS: { title: string; d: Partial<DraftInput> }[] = [
  { title: 'Renewal reminder', d: { name: 'renewal_reminder', category: 'marketing', body: 'Hi {{1}}, your {{2}} plan ends on {{3}}. Renew today to keep your access without a break.', footer: 'Reply STOP to opt out', samples: ['Asha', 'Gold', '30 Nov'], buttons: [{ type: 'url', text: 'Renew now', value: 'https://example.com/pay/{{1}}' }, { type: 'quick_reply', text: 'Stop promotions' }] } },
  { title: 'Payment received', d: { name: 'payment_received', category: 'utility', body: 'Hi {{1}}, we received your payment of ₹{{2}}. Your plan is active until {{3}}. Thank you.', samples: ['Asha', '499', '30 Dec'], buttons: [] } },
  { title: 'Festival offer', d: { name: 'festival_offer', category: 'marketing', headerText: 'Festival offer', body: 'Hi {{1}}, enjoy a special festival price on all plans this week. Reply to this message to know more.', footer: 'Reply STOP to opt out', samples: ['Asha'], buttons: [{ type: 'quick_reply', text: 'Tell me more' }, { type: 'quick_reply', text: 'Stop promotions' }] } },
  { title: 'Order update', d: { name: 'order_update', category: 'utility', body: 'Hi {{1}}, your order {{2}} has been shipped and will reach you in 2 to 3 days.', samples: ['Asha', '#1042'], buttons: [] } },
];

const empty: DraftInput = { name: '', language: 'en', category: 'marketing', headerText: '', headerMedia: null, assetId: null, body: '', footer: '', buttons: [], samples: [] };

export function TemplatesView({ initial, canEdit }: { initial: TemplateRow[]; canEdit: boolean }) {
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState<'all' | string>('all');
  const [editing, setEditing] = useState<null | (DraftInput & { id?: string; status?: string; assetName?: string | null })>(null);
  const [toast, setToast] = useState('');
  const [pending, start] = useTransition();
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3500); };

  async function refresh(m?: string) {
    const { listTemplates } = await import('@/app/(app)/templates/actions');
    setRows(await listTemplates()); if (m) flash(m);
  }
  // While Meta is reviewing something, look for its answer every 15 s. Stops by itself once nothing is waiting.
  const waiting = rows.some((r) => r.status === 'pending' && r.live);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => { void refresh(); }, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);
  const shown = rows.filter((r) => filter === 'all' || r.status === filter);
  const counts = (s: string) => rows.filter((r) => r.status === s).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h2 className="font-display text-2xl font-extrabold">Templates</h2><p className="text-sm text-muted">Official WhatsApp message formats. Only approved ones can be sent to customers.</p></div>
        {canEdit ? <Button onClick={() => setEditing({ ...empty })}><Plus className="size-4" />New template</Button> : null}
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" role="tablist">
        {[['all', 'All', rows.length], ['approved', 'Approved', counts('approved')], ['pending', 'In review', counts('pending')], ['draft', 'Drafts', counts('draft')], ['rejected', 'Rejected', counts('rejected')]].map(([id, l, n]) => (
          <button key={id as string} role="tab" aria-selected={filter === id} onClick={() => setFilter(id as string)} className={cn('min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold', filter === id ? 'grad-bg border-transparent text-white' : 'border-line bg-card text-muted')}>{l as string} <span className="tabular opacity-80">{n as number}</span></button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="card p-8">
          <h3 className="font-display text-lg font-bold">Start from a ready-made format</h3>
          <p className="mb-5 text-sm text-muted">Pick one and change the words. The checker tells you if anything could be rejected.</p>
          <div className="grid gap-3 sm:grid-cols-2">{STARTERS.map((s) => (
            <button key={s.title} disabled={!canEdit} onClick={() => setEditing({ ...empty, ...s.d } as DraftInput)} className="card card-hover p-4 text-left">
              <span className="text-xs font-semibold text-brand">{CAT[s.d.category as Category].label}</span><p className="font-semibold">{s.title}</p><p className="mt-1 line-clamp-2 text-sm text-muted">{s.d.body}</p>
            </button>))}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((t) => { const [sl, sc] = STATUS[t.status] ?? STATUS.draft!; return (
            <article key={t.id} className="card card-hover flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><h3 className="truncate font-mono text-sm font-bold">{t.name}</h3><p className="text-xs text-muted">{CAT[t.category].label} · {t.language}</p></div>
                <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-bold', sc)}>{sl}</span>
              </div>
              <WaBubble header={t.headerText} media={t.headerMedia ? { kind: t.headerMedia, src: t.assetId ? `/api/template-assets/${t.assetId}` : null, name: t.assetName } : null} body={t.body} footer={t.footer} buttons={t.buttons} values={t.samples} />
              {t.status === 'rejected' ? <p className="flex gap-2 rounded-xl bg-rose/10 p-3 text-xs text-rose"><XCircle className="size-4 shrink-0" />{explainRejection(t.rejectionReason)}</p> : null}
              {t.status === 'draft' && t.submitError ? <p className="flex gap-2 rounded-xl bg-rose/10 p-3 text-xs text-rose"><XCircle className="size-4 shrink-0" />{t.submitError}</p> : null}
              {t.status === 'paused' ? <p className="flex gap-2 rounded-xl bg-amber/10 p-3 text-xs text-amber"><XCircle className="size-4 shrink-0" />Meta paused this format because customers reacted badly. It can not be sent for a few hours, then it works again by itself.</p> : null}
              {t.status === 'disabled' ? <p className="flex gap-2 rounded-xl bg-rose/10 p-3 text-xs text-rose"><XCircle className="size-4 shrink-0" />Meta turned this format off. Create a new one with different wording.</p> : null}
              {t.status === 'approved' ? <p className={cn('text-xs font-semibold', QUALITY[t.quality])}>Quality: {t.quality === 'unknown' ? 'not rated yet' : t.quality}</p> : null}
              {t.status === 'pending' && t.live ? (
                <p className="flex gap-2 rounded-xl bg-amber/10 p-3 text-xs text-amber"><Loader2 className="size-4 shrink-0 animate-spin" />Sent to WhatsApp for review. Meta usually answers within minutes, sometimes up to 24 hours. This page updates by itself.</p>
              ) : null}
              {t.status === 'pending' && !t.live ? (
                <div className="rounded-xl border border-dashed border-amber/50 bg-amber/5 p-3 text-xs"><p className="mb-2 flex items-center gap-1.5 font-semibold text-amber"><FlaskConical className="size-3.5" />Test mode: no WhatsApp number is connected, so Meta has not seen this.</p>
                  {canEdit ? <div className="flex flex-wrap gap-2"><Button size="sm" variant="soft" disabled={pending} onClick={() => start(async () => { const r = await simulateReview(t.id, 'approved'); if (!r.ok) flash(r.error); else await refresh('Marked approved (test).'); })}>Mark approved</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { const r = await simulateReview(t.id, 'rejected'); if (!r.ok) flash(r.error); else await refresh('Marked rejected (test).'); })}>Mark rejected</Button></div> : null}</div>
              ) : null}
              {canEdit ? (
                <div className="mt-auto flex flex-wrap gap-2 border-t border-line pt-3">
                  {t.status !== 'pending' ? <Button size="sm" variant="outline" onClick={() => setEditing({ id: t.id, status: t.status, name: t.name, language: t.language as 'en', category: t.category, headerText: t.headerText ?? '', headerMedia: t.headerMedia, assetId: t.assetId, assetName: t.assetName, body: t.body, footer: t.footer ?? '', buttons: t.buttons, samples: t.samples })}>Edit</Button> : null}
                  <Button size="sm" variant="ghost" onClick={() => start(async () => { const r = await duplicateTemplate(t.id); if (!r.ok) flash(r.error); else await refresh('Copied as a draft.'); })}><Copy className="size-4" />Copy</Button>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${t.name}`} onClick={() => { if (confirm(`Delete the message format “${t.name}”?`)) start(async () => { const r = await deleteTemplate(t.id); if (!r.ok) flash(r.error); else await refresh('Deleted.'); }); }}><Trash2 className="size-4 text-rose" /></Button>
                </div>
              ) : null}
            </article>); })}
          {shown.length === 0 ? <p className="col-span-full py-10 text-center text-sm text-muted">Nothing here.</p> : null}
        </div>
      )}

      {editing ? <Builder key={editing.id ?? 'new'} initial={editing} others={rows.filter((r) => r.id !== editing.id)} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); void refresh(m); }} /> : null}
      {toast ? <div role="status" className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-bg shadow-xl md:bottom-8">{toast}</div> : null}
    </div>
  );
}

const d0src = (i: { assetId?: string | null; headerMedia?: string | null }) => (i.assetId && i.headerMedia === 'image' ? `/api/template-assets/${i.assetId}` : null);

function Builder({ initial, others, onClose, onSaved }: { initial: DraftInput & { id?: string; assetName?: string | null }; others: TemplateRow[]; onClose: () => void; onSaved: (m: string) => void }) {
  const [d, setD] = useState<DraftInput & { id?: string }>(initial);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const [fileName, setFileName] = useState<string | null>(initial.assetName ?? null);
  const [preview, setPreview] = useState<string | null>(d0src(initial));
  const [uploading, setUploading] = useState(false);
  const set = <K extends keyof DraftInput>(k: K, v: DraftInput[K]) => setD((p) => ({ ...p, [k]: v }));
  const nVars = useMemo(() => [...new Set(variablesIn(d.body))].length, [d.body]);
  const samples = Array.from({ length: nVars }, (_, i) => d.samples[i] ?? '');
  const lint = useMemo(() => lintTemplate({ name: d.name, category: d.category, headerText: d.headerText, headerMedia: d.headerMedia ?? undefined, hasHeaderFile: !!d.assetId, body: d.body, footer: d.footer, buttons: d.buttons, samples }, others.map((o) => o.name), others.map((o) => o.body)), [d, others, samples]);
  const blocks = lint.issues.filter((i) => i.level === 'block'), warns = lint.issues.filter((i) => i.level === 'warn');
  const addBtn = (type: 'quick_reply' | 'url' | 'phone' | 'copy_code') => set('buttons', [...d.buttons, { type, text: type === 'copy_code' ? 'Copy code' : '', value: '' }]);
  const upBtn = (i: number, patch: Partial<DraftInput['buttons'][number]>) => set('buttons', d.buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  const [err2, setErr2] = useState('');
  async function upload(f: File) {
    setErr2('');
    const kind = d.headerMedia!;
    const c = checkHeaderMedia(new Uint8Array(await f.arrayBuffer()), kind); // same check the server repeats; this one just answers instantly
    if (!c.ok) { setErr2(c.error); return; }
    setUploading(true);
    try {
      const fd = new FormData(); fd.set('kind', kind); fd.set('file', f);
      const r = await fetch('/api/template-assets', { method: 'POST', body: fd });
      const j = (await r.json().catch(() => ({ ok: false, error: 'The upload failed. Try again.' }))) as { ok: boolean; error?: string; asset?: { id: string; name: string } };
      if (!j.ok || !j.asset) { setErr2(j.error ?? 'The upload failed. Try again.'); return; }
      setD((p) => ({ ...p, assetId: j.asset!.id })); setFileName(j.asset.name);
      setPreview(kind === 'image' ? `/api/template-assets/${j.asset.id}` : null);
    } catch { setErr2('Could not upload. Check your connection and try again.'); }
    finally { setUploading(false); }
  }

  function save(submit: boolean) {
    setError('');
    start(async () => {
      const r = await saveTemplate({ ...d, samples });
      if (!r.ok) { setError(r.error); return; }
      if (submit) { const s = await submitTemplate(r.data.id); if (!s.ok) { setError(s.error); return; } onSaved(s.data.testMode ? 'Submitted for review (test mode).' : 'Sent to WhatsApp for review. We will show the result here.'); } else onSaved('Draft saved.');
    });
  }

  return (
    <Modal open onClose={onClose} title={d.id ? "Edit template" : "New template"} wide>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          <FormError>{error}</FormError>
          <Field label="Type" hint={CAT[d.category].hint}>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Template type">
              {(Object.keys(CAT) as Category[]).map((c) => (
                <button key={c} type="button" role="radio" aria-checked={d.category === c} onClick={() => set('category', c)} className={cn('min-h-14 rounded-xl border px-2 text-sm font-semibold', d.category === c ? 'border-brand bg-brand/10 text-brand' : 'border-line')}>{CAT[c].label}<span className="block text-[11px] font-normal text-muted">{CAT[c].price} each</span></button>))}
            </div>
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <Field label="Name" hint="Lowercase letters, numbers, underscores"><Input value={d.name} onChange={(e) => set('name', e.target.value.toLowerCase().replace(/\s+/g, '_'))} placeholder="diwali_offer_2026" maxLength={80} /></Field>
            <Field label="Language"><Select value={d.language} onChange={(e) => set('language', e.target.value as 'en')}><option value="en">English</option><option value="hi">Hindi</option></Select></Field>
          </div>
          <fieldset className="rounded-xl border border-line p-3"><legend className="px-1 text-sm font-semibold">Header (optional)</legend>
            <div className="mb-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Header type">
              {([[null, 'None'], ['text', 'Text'], ['image', 'Picture'], ['video', 'Video'], ['document', 'PDF']] as const).map(([k, l]) => {
                const cur = d.headerMedia ?? (d.headerText ? 'text' : null);
                return <button key={l} type="button" role="radio" aria-checked={cur === k} disabled={d.category === 'authentication' && k !== null} onClick={() => { setErr2(''); if (k === 'text') { setD((p) => ({ ...p, headerMedia: null, assetId: null })); } else if (k === null) { setD((p) => ({ ...p, headerMedia: null, assetId: null, headerText: '' })); setFileName(null); setPreview(null); } else { setD((p) => ({ ...p, headerMedia: k, assetId: p.headerMedia === k ? p.assetId : null, headerText: '' })); if (d.headerMedia !== k) { setFileName(null); setPreview(null); } } }} className={cn('min-h-10 rounded-full border px-3.5 text-sm font-semibold disabled:opacity-40', cur === k ? 'border-brand bg-brand/10 text-brand' : 'border-line')}>{l}</button>;
              })}
            </div>
            {d.headerMedia ? (
              <div className="flex flex-col gap-2">
                <label className={cn('flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2 text-sm hover:border-brand/60', uploading && 'opacity-60')}>
                  {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
                  <span className="min-w-0 flex-1 truncate">{fileName ?? `Choose ${MEDIA_LIMITS[d.headerMedia].label}`}</span>
                  <input type="file" className="sr-only" accept={MEDIA_LIMITS[d.headerMedia].mime.join(',')} disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
                </label>
                {err2 ? <p role="alert" className="rounded-lg bg-rose/10 p-2 text-xs text-rose">{err2}</p> : <p className="text-xs text-muted">WhatsApp shows this file above your message. Keep it clear and relevant.</p>}
              </div>
            ) : (
              <Input value={d.headerText ?? ''} onChange={(e) => set('headerText', e.target.value)} maxLength={80} placeholder="Short title above the message (optional)" aria-label="Header text" />
            )}
          </fieldset>
          <Field label="Message" hint={`Use {{1}}, {{2}} for name, date or amount. ${d.body.length}/1024`}><Textarea value={d.body} onChange={(e) => set('body', e.target.value)} rows={6} /></Field>
          {nVars > 0 ? (
            <fieldset className="rounded-xl border border-line p-3"><legend className="px-1 text-sm font-semibold">Sample values</legend>
              <p className="mb-2 text-xs text-muted">Meta reviews your message using these examples. Use realistic values.</p>
              <div className="grid gap-2 sm:grid-cols-2">{samples.map((s, i) => <Input key={i} aria-label={`Sample for {{${i + 1}}}`} placeholder={`{{${i + 1}}}`} value={s} onChange={(e) => set('samples', samples.map((x, j) => (j === i ? e.target.value : x)))} />)}</div></fieldset>) : null}
          <Field label="Footer (optional)"><Input value={d.footer ?? ''} onChange={(e) => set('footer', e.target.value)} placeholder="Reply STOP to opt out" maxLength={80} /></Field>
          <fieldset className="rounded-xl border border-line p-3"><legend className="px-1 text-sm font-semibold">Buttons</legend>
            <div className="flex flex-col gap-2">{d.buttons.map((b, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-xl bg-card2 p-2 sm:grid-cols-[7rem_1fr_1fr_auto]">
                <span className="text-xs font-semibold text-muted">{{ quick_reply: 'Quick reply', url: 'Website', phone: 'Call', copy_code: 'Copy code' }[b.type]}</span>
                <Input aria-label="Button label" placeholder="Label" value={b.text} onChange={(e) => upBtn(i, { text: e.target.value })} className="col-span-2 sm:col-span-1" maxLength={30} />
                {b.type === 'url' || b.type === 'phone' ? <Input aria-label="Button value" placeholder={b.type === 'url' ? 'https://…/{{1}}' : '+91…'} value={b.value ?? ''} onChange={(e) => upBtn(i, { value: e.target.value })} className="col-span-2 sm:col-span-1" /> : <span className="hidden sm:block" />}
                <button type="button" aria-label="Remove button" onClick={() => set('buttons', d.buttons.filter((_, j) => j !== i))} className="flex size-11 items-center justify-center rounded-lg hover:bg-ink/5 sm:col-start-4"><X className="size-4" /></button>
              </div>))}</div>
            <div className="mt-2 flex flex-wrap gap-2">{(['quick_reply', 'url', 'phone', 'copy_code'] as const).map((t) => <Button key={t} type="button" size="sm" variant="outline" onClick={() => addBtn(t)}><Plus className="size-3.5" />{{ quick_reply: 'Quick reply', url: 'Website', phone: 'Call', copy_code: 'Copy code' }[t]}</Button>)}</div>
          </fieldset>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-0 lg:self-start">
          <WaBubble header={d.headerText} media={d.headerMedia ? { kind: d.headerMedia, src: preview, name: fileName } : null} body={d.body} footer={d.footer} buttons={d.buttons} values={samples} />
          <div className={cn('rounded-2xl border p-3 text-sm', lint.risk === 'low' ? 'border-brand/40 bg-brand/5' : lint.risk === 'medium' ? 'border-amber/40 bg-amber/5' : 'border-rose/40 bg-rose/5')} aria-live="polite">
            <p className="mb-1.5 flex items-center gap-2 font-bold">{lint.risk === 'low' ? <CheckCircle2 className="size-4 text-brand" /> : <AlertTriangle className={cn('size-4', lint.risk === 'high' ? 'text-rose' : 'text-amber')} />}Rejection risk: {lint.risk}</p>
            <ul className="space-y-1.5 text-xs">{blocks.map((i, k) => <li key={`b${k}`} className="flex gap-1.5 text-rose"><XCircle className="mt-0.5 size-3.5 shrink-0" />{i.message}</li>)}{warns.map((i, k) => <li key={`w${k}`} className="flex gap-1.5 text-amber"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{i.message}</li>)}{lint.issues.length === 0 ? <li className="text-muted">Nothing to fix. Looks ready.</li> : null}</ul>
            {lint.suggestedCategory ? <Button size="sm" variant="soft" className="mt-2" onClick={() => set('category', lint.suggestedCategory!)}>Switch to Promotional</Button> : null}
          </div>
          <div className="flex flex-col gap-2">
            <Button disabled={pending || !d.name.trim() || !d.body.trim() || lint.blocked} onClick={() => save(true)}>{pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}Submit for review</Button>
            <Button variant="outline" disabled={pending || !d.name.trim() || !d.body.trim()} onClick={() => save(false)}>Save draft</Button>
          </div>
        </aside>
      </div>
    </Modal>
  );
}
