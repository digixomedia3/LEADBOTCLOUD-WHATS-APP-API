'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import Papa from 'papaparse';
import { Check, Copy, Download, ExternalLink, FileText, Loader2, MessageCircle, Plus, QrCode, Trash2, Upload } from 'lucide-react';
import { normalizePhone } from '@lbc/shared';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { createForm, deleteForm, importLeads, listForms, qrFor, setFormEnabled, updateForm, whatsappLink, widgetSnippet, type FormRow, type LeadImportReport } from '@/app/(app)/leads/channels-actions';
import { listSources, type SourcesData } from '@/app/(app)/leads/actions';
import { cn } from '@/lib/utils';

type Section = 'forms' | 'links' | 'widget' | 'import';
const SECTIONS: [Section, string, string][] = [['forms', 'Forms', 'A page with a form you can share anywhere'], ['links', 'QR and links', 'Posters, flyers, shop counters, bios'], ['widget', 'Website button', 'Floating WhatsApp button for your site'], ['import', 'Import a list', 'From Excel, Google Sheets or an old CRM']];

function useCopy() { const [c, setC] = useState(''); return { c, copy: async (id: string, t: string) => { await navigator.clipboard.writeText(t).catch(() => undefined); setC(id); setTimeout(() => setC(''), 1500); } }; }
function Code({ id, text, copy, c, rows = 6 }: { id: string; text: string; copy: (id: string, t: string) => void; c: string; rows?: number }) {
  return <div className="relative"><pre className="overflow-auto rounded-lg bg-slate-900 p-3 pr-12 text-xs text-slate-100" style={{ maxHeight: `${rows * 1.25 + 1.5}rem` }}>{text}</pre><button type="button" aria-label="Copy" onClick={() => copy(id, text)} className="absolute right-2 top-2 grid size-8 place-items-center rounded-md bg-white/10 text-white hover:bg-white/20">{c === id ? <Check className="size-4" /> : <Copy className="size-4" />}</button></div>;
}

export function ChannelsPanel({ canManage }: { canManage: boolean }) {
  const [sec, setSec] = useState<Section>('forms');
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-4">
        {SECTIONS.map(([k, l, d]) => (
          <button key={k} onClick={() => setSec(k)} className={cn('rounded-xl border p-3 text-left', sec === k ? 'border-brand bg-brand/5' : 'border-line bg-card hover:border-brand/50')}>
            <p className="text-sm font-bold">{l}</p><p className="mt-0.5 text-xs text-muted">{d}</p>
          </button>
        ))}
      </div>
      {!canManage ? <p className="rounded-xl border border-line bg-surface-2 p-3 text-sm text-muted">Only owners and admins can create forms, links and imports.</p> : null}
      {sec === 'forms' ? <FormsSection canManage={canManage} /> : sec === 'links' ? <LinksSection /> : sec === 'widget' ? <WidgetSection /> : <ImportSection canManage={canManage} />}
    </div>
  );
}

/* ------------------------------------------------------------------ forms */
function FormsSection({ canManage }: { canManage: boolean }) {
  const [d, setD] = useState<{ forms: FormRow[]; base: string } | null>(null);
  const [src, setSrc] = useState<SourcesData | null>(null);
  const [edit, setEdit] = useState<FormRow | 'new' | null>(null);
  const [qr, setQr] = useState<FormRow | null>(null);
  const [msg, setMsg] = useState('');
  const { c, copy } = useCopy();
  const refresh = useCallback(async () => { setD(await listForms()); }, []);
  useEffect(() => { void refresh(); void listSources().then(setSrc); }, [refresh]);
  if (!d) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <div className="flex flex-col gap-3">
      {!d.base ? <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">The public address of this app is not set (<code>APP_URL</code>), so form links below are incomplete.</p> : null}
      {msg ? <p className="text-sm text-emerald-700">{msg}</p> : null}
      <div className="flex items-center justify-between gap-3"><p className="text-sm text-muted">A form is a public page. Share its link or QR code; every answer lands in your Leads inbox.</p>{canManage ? <Button onClick={() => setEdit('new')}><Plus className="size-4" />New form</Button> : null}</div>
      {d.forms.length === 0 ? <div className="card px-6 py-10 text-center text-sm text-muted">No forms yet. Create one in a minute: a title, a few questions, done.</div> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {d.forms.map((f) => (
            <li key={f.id} className={cn('card flex min-w-0 flex-col gap-2 overflow-hidden p-4', !f.enabled && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2"><div className="min-w-0 flex-1"><h3 className="truncate font-display font-bold">{f.title}</h3><p className="truncate text-xs text-muted">{f.url}</p></div>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold', f.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700')}>{f.enabled ? 'On' : 'Off'}</span></div>
              <p className="text-sm"><b>{f.submits}</b> {f.submits === 1 ? 'lead' : 'leads'} from <b>{f.views}</b> {f.views === 1 ? 'visit' : 'visits'}{f.views >= 5 ? <span className="text-muted"> · {Math.min(100, Math.round((f.submits / f.views) * 100))}% fill it in</span> : null}</p>
              <p className={cn('break-words text-xs', f.consentText ? 'text-emerald-700' : 'text-amber-700')}>{f.consentText ? 'Has a WhatsApp consent box. Ticked = you can send offers.' : 'No consent box. These leads are reply-only (no offers).'}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => copy(f.id, f.url)}>{c === f.id ? <Check className="size-4" /> : <Copy className="size-4" />}Copy link</Button>
                <Button size="sm" variant="outline" onClick={() => setQr(f)}><QrCode className="size-4" />QR</Button>
                <a className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-line px-3 text-sm font-semibold hover:border-brand" href={f.url} target="_blank" rel="noreferrer"><ExternalLink className="size-4" />Open</a>
                {canManage ? <><Button size="sm" variant="outline" onClick={() => setEdit(f)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={async () => { const r = await setFormEnabled(f.id, !f.enabled); setMsg(r.ok ? '' : r.error); await refresh(); }}>{f.enabled ? 'Turn off' : 'Turn on'}</Button>
                  <Button size="icon" variant="ghost" className="size-10" aria-label="Delete form" onClick={async () => { if (!confirm(`Delete “${f.title}”? Leads it collected are kept.`)) return; const r = await deleteForm(f.id); setMsg(r.ok ? 'Form deleted. Leads kept.' : r.error); await refresh(); }}><Trash2 className="size-4" /></Button></> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {edit && src ? <FormEditor src={src} form={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={async (m) => { setEdit(null); setMsg(m); await refresh(); }} /> : null}
      {qr ? <QrModal title={qr.title} url={qr.url} onClose={() => setQr(null)} /> : null}
    </div>
  );
}

function FormEditor({ src, form, onClose, onDone }: { src: SourcesData; form: FormRow | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [title, setTitle] = useState(form?.title ?? '');
  const [intro, setIntro] = useState(form?.intro ?? '');
  const [button, setButton] = useState(form?.buttonText ?? 'Send');
  const [thanks, setThanks] = useState(form?.thankYou ?? 'Thank you! We will message you on WhatsApp shortly.');
  const [email, setEmail] = useState(form?.askEmail ?? false);
  const [extra, setExtra] = useState<{ label: string; required: boolean }[]>((form?.extraFields ?? []).map((x) => ({ label: x.label, required: !!x.required })));
  const [consent, setConsent] = useState(!!form?.consentText);
  const [consentText, setConsentText] = useState(form?.consentText ?? 'I agree to receive WhatsApp messages and offers from this business.');
  const [accent, setAccent] = useState(form?.accent ?? '#10b981');
  const [assign, setAssign] = useState<string[]>([]);
  const [group, setGroup] = useState('');
  const [err, setErr] = useState('');
  const [busy, start] = useTransition();
  const save = () => start(async () => {
    setErr('');
    const input = { title, intro: intro.trim() || null, buttonText: button, thankYou: thanks, askEmail: email, extraFields: extra.filter((x) => x.label.trim()), consentText: consent ? consentText : null, accent, tags: [], assignUserIds: assign, groupId: group || null };
    const r = form ? await updateForm(form.id, input) : await createForm(input);
    if (!r.ok) { setErr(r.error); return; }
    onDone(form ? 'Form saved.' : 'Form created. Copy its link or QR code to start collecting leads.');
  });
  return (
    <Modal open onClose={onClose} title={form ? 'Edit form' : 'New form'} wide>
      <div className="grid gap-4 md:grid-cols-[1fr_17rem]">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Title"><Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Get a free quote" /></Field></div>
          <div className="sm:col-span-2"><Field label="Short message (optional)"><Textarea rows={2} maxLength={300} value={intro} onChange={(e) => setIntro(e.target.value)} placeholder="Tell us what you need and we will reply on WhatsApp." /></Field></div>
          <Field label="Button text"><Input value={button} maxLength={30} onChange={(e) => setButton(e.target.value)} /></Field>
          <Field label="Colour"><Input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="h-11 p-1" /></Field>
          <div className="sm:col-span-2"><Field label="After they send"><Input value={thanks} maxLength={200} onChange={(e) => setThanks(e.target.value)} /></Field></div>
          <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} />Also ask for email</label>
          <div className="sm:col-span-2"><p className="mb-1 text-sm font-semibold">Extra questions <span className="font-normal text-muted">(name and WhatsApp number are always asked)</span></p>
            <div className="flex flex-col gap-2">{extra.map((x, i) => (
              <div key={i} className="flex items-center gap-2"><Input value={x.label} maxLength={60} placeholder="e.g. City, Budget, Product you want" onChange={(e) => setExtra(extra.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
                <label className="flex shrink-0 items-center gap-1 text-xs"><input type="checkbox" checked={x.required} onChange={(e) => setExtra(extra.map((y, j) => (j === i ? { ...y, required: e.target.checked } : y)))} />Required</label>
                <button type="button" aria-label="Remove question" className="grid size-10 shrink-0 place-items-center rounded-lg hover:bg-ink/5" onClick={() => setExtra(extra.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button></div>
            ))}{extra.length < 6 ? <Button variant="outline" size="sm" className="w-fit" onClick={() => setExtra([...extra, { label: '', required: false }])}><Plus className="size-4" />Add question</Button> : null}</div></div>
          <div className="rounded-xl border border-line p-3 sm:col-span-2">
            <label className="flex items-start gap-2 text-sm font-semibold"><input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />Show a WhatsApp consent box</label>
            <p className="mt-1 text-xs text-muted">{consent ? 'People who tick it can be sent offers and campaigns. Write the exact sentence they agree to.' : 'Without it, people who fill the form are reply-only: you can answer them, but offers and campaigns skip them.'}</p>
            {consent ? <Textarea className="mt-2" rows={2} maxLength={300} value={consentText} onChange={(e) => setConsentText(e.target.value)} /> : null}</div>
          {!form ? <>
            <Field label="Add leads to group"><Select value={group} onChange={(e) => setGroup(e.target.value)}><option value="">None</option>{src.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></Field>
            <Field label="Share leads between"><div className="flex flex-wrap gap-2">{src.members.map((m) => <label key={m.id} className={cn('flex min-h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm', assign.includes(m.id) ? 'border-brand bg-brand/10' : 'border-line')}><input type="checkbox" className="hidden" checked={assign.includes(m.id)} onChange={() => setAssign((a) => (a.includes(m.id) ? a.filter((x) => x !== m.id) : [...a, m.id]))} />{m.name}</label>)}</div></Field></> : null}
          {err ? <div className="sm:col-span-2"><FormError>{err}</FormError></div> : null}
          <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}{form ? 'Save form' : 'Create form'}</Button></div>
        </div>
        <div className="hidden md:block">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Preview</p>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <h4 className="text-lg font-extrabold text-slate-900">{title || 'Your title'}</h4>{intro ? <p className="mt-1 text-xs text-slate-600">{intro}</p> : null}
              <div className="mt-3 flex flex-col gap-2">{['Your name', 'WhatsApp number', ...(email ? ['Email'] : []), ...extra.filter((x) => x.label.trim()).map((x) => x.label)].map((l) => <div key={l} className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-400">{l}</div>)}
                {consent ? <div className="flex items-start gap-2 text-[11px] text-slate-600"><span className="mt-0.5 size-3.5 shrink-0 rounded border border-slate-400" />{consentText}</div> : null}
                <div className="rounded-lg py-2 text-center text-xs font-bold text-white" style={{ background: accent }}>{button || 'Send'}</div></div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function QrModal({ title, url, onClose }: { title: string; url: string; onClose: () => void }) {
  const [svg, setSvg] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { void qrFor(url).then((r) => (r.ok ? setSvg(r.data.svg) : setErr(r.error))); }, [url]);
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); a.download = `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-qr.svg`; a.click(); URL.revokeObjectURL(a.href); };
  return (
    <Modal open onClose={onClose} title={`QR code: ${title}`}>
      <div className="flex flex-col items-center gap-3">
        {err ? <FormError>{err}</FormError> : svg ? <div className="size-64 rounded-xl border border-line bg-white p-2 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} /> : <Loader2 className="size-6 animate-spin" />}
        <p className="max-w-xs break-all text-center text-xs text-muted">{url}</p>
        <p className="text-center text-xs text-muted">Print it on a poster, flyer, bill or shop counter. It is a vector file, so it stays sharp at any size.</p>
        <Button onClick={download} disabled={!svg}><Download className="size-4" />Download (SVG)</Button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ QR + wa.me links */
function LinksSection() {
  const [phone, setPhone] = useState(''); const [message, setMessage] = useState('Hi, I saw your ad and I am interested.'); const [tag, setTag] = useState('');
  const [url, setUrl] = useState(''); const [err, setErr] = useState(''); const [busy, start] = useTransition();
  const { c, copy } = useCopy();
  const make = () => start(async () => { setErr(''); setUrl(''); const r = await whatsappLink({ phone, message, tag }); if (!r.ok) { setErr(r.error); return; } setUrl(r.data.url); });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="card flex flex-col gap-3 p-4">
        <h3 className="font-display font-bold">WhatsApp chat link and QR</h3>
        <p className="text-sm text-muted">Anyone who taps the link or scans the QR opens a chat with you and your message ready to send. Add a tag for each place (poster, bill, Instagram bio) to see where chats come from.</p>
        <Field label="Your WhatsApp number"><Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" /></Field>
        <Field label="Message they send"><Textarea rows={2} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        <Field label="Where will you put it? (optional)" hint="For example: shop-poster. It is added to the message in [brackets]."><Input maxLength={40} value={tag} onChange={(e) => setTag(e.target.value)} /></Field>
        {err ? <FormError>{err}</FormError> : null}
        <Button onClick={make} disabled={busy || !phone.trim()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <MessageCircle className="size-4" />}Make link</Button>
      </div>
      <div className="card flex flex-col items-center justify-center gap-3 p-4">
        {url ? <>
          <WaQr url={url} />
          <div className="w-full"><Code id="wa" text={url} copy={copy} c={c} rows={2} /></div>
          <p className="text-center text-xs text-muted">Test it on your own phone before you print.</p>
        </> : <p className="text-sm text-muted">Your link and QR code appear here.</p>}
      </div>
    </div>
  );
}
function WaQr({ url }: { url: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => { void qrFor(url).then((r) => setSvg(r.ok ? r.data.svg : '')); }, [url]);
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); a.download = 'whatsapp-qr.svg'; a.click(); URL.revokeObjectURL(a.href); };
  return <><div className="size-56 rounded-xl border border-line bg-white p-2 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} /><Button variant="outline" size="sm" onClick={download} disabled={!svg}><Download className="size-4" />Download QR (SVG)</Button></>;
}

/* ------------------------------------------------------------------ website button */
function WidgetSection() {
  const [phone, setPhone] = useState(''); const [message, setMessage] = useState('Hi! I have a question.'); const [label, setLabel] = useState('Chat with us');
  const [pos, setPos] = useState<'right' | 'left'>('right'); const [color, setColor] = useState('#25d366');
  const [code, setCode] = useState(''); const [err, setErr] = useState(''); const [busy, start] = useTransition();
  const { c, copy } = useCopy();
  const make = () => start(async () => { setErr(''); setCode(''); const r = await widgetSnippet({ phone, message, label, position: pos, color }); if (!r.ok) { setErr(r.error); return; } setCode(r.data.code); });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="card flex flex-col gap-3 p-4">
        <h3 className="font-display font-bold">Floating WhatsApp button</h3>
        <p className="text-sm text-muted">Paste one snippet before the closing &lt;/body&gt; tag of your website (Wix, Webflow, WordPress, Shopify, plain HTML). It also passes the ad campaign the visitor came from, so you can see it in the chat.</p>
        <Field label="Your WhatsApp number"><Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" /></Field>
        <Field label="Message"><Input maxLength={120} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        <div className="grid grid-cols-3 gap-2"><Field label="Button text"><Input maxLength={30} value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
          <Field label="Side"><Select value={pos} onChange={(e) => setPos(e.target.value as 'right')}><option value="right">Right</option><option value="left">Left</option></Select></Field>
          <Field label="Colour"><Input type="color" className="h-11 p-1" value={color} onChange={(e) => setColor(e.target.value)} /></Field></div>
        {err ? <FormError>{err}</FormError> : null}
        <Button onClick={make} disabled={busy || !phone.trim()}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}Get snippet</Button>
      </div>
      <div className="card flex flex-col gap-3 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Preview</p>
        <div className="relative h-28 rounded-xl border border-dashed border-line bg-surface-2"><span className={cn('absolute bottom-3 flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-lg', pos === 'right' ? 'right-3' : 'left-3')} style={{ background: color }}><MessageCircle className="size-5" />{label || 'Chat with us'}</span></div>
        {code ? <Code id="w" text={code} copy={copy} c={c} rows={10} /> : <p className="text-sm text-muted">Your snippet appears here.</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ import */
const MAX_BYTES = 5 * 1024 * 1024;
function ImportSection({ canManage }: { canManage: boolean }) {
  const [file, setFile] = useState(''); const [headers, setHeaders] = useState<string[]>([]); const [data, setData] = useState<string[][]>([]);
  const [map, setMap] = useState<{ phone: number; name: number; email: number }>({ phone: -1, name: -1, email: -1 });
  const [name, setName] = useState('Imported list'); const [consent, setConsent] = useState(false);
  const [err, setErr] = useState(''); const [rep, setRep] = useState<LeadImportReport | null>(null); const [busy, start] = useTransition();
  const guess = (hs: string[], re: RegExp) => hs.findIndex((h) => re.test(h.trim()));
  function load(f: File) {
    setErr(''); setRep(null);
    if (f.size > MAX_BYTES) { setErr('This file is larger than 5 MB. Split it and try again.'); return; }
    if (!/\.(csv|txt|tsv)$/i.test(f.name)) { setErr('Please choose a CSV file. In Excel or Google Sheets use File > Save as > CSV.'); return; }
    Papa.parse<string[]>(f, { skipEmptyLines: 'greedy', complete: (r) => {
      const all = r.data as string[][]; if (all.length < 2) { setErr('The file needs a header row and at least one person.'); return; }
      const [h, ...body] = all; const hs = h!.map((x) => String(x ?? ''));
      setFile(f.name); setHeaders(hs); setData(body); setName(f.name.replace(/\.[^.]+$/, '').slice(0, 60));
      setMap({ phone: guess(hs, /^(phone|mobile|mob|whatsapp|number|contact|cell|tel|फोन|मोबाइल|नंबर)/i), name: guess(hs, /^(name|full ?name|customer|client|नाम)/i), email: guess(hs, /^(e-?mail|mail|ईमेल)/i) });
    }, error: () => setErr('We could not read this file. Save it as CSV (UTF-8).') });
  }
  const rows = useMemo(() => data.map((r, i) => ({ line: i + 2, phone: map.phone >= 0 ? String(r[map.phone] ?? '') : '', name: map.name >= 0 ? String(r[map.name] ?? '') : '', email: map.email >= 0 ? String(r[map.email] ?? '') : '',
    extra: Object.fromEntries(headers.map((h, j) => [h, String(r[j] ?? '')]).filter(([, v], j) => v && j !== map.phone && j !== map.name && j !== map.email)) as Record<string, string> })), [data, headers, map]);
  const valid = useMemo(() => rows.filter((r) => normalizePhone(r.phone).ok).length, [rows]);
  const run = () => start(async () => { setErr(''); const r = await importLeads({ rows, sourceName: name, consent }); if (!r.ok) { setErr(r.error); return; } setRep(r.data); });
  const errorsCsv = () => { if (!rep) return; const csv = Papa.unparse([['line', 'reason'], ...rep.errors.map((e) => [e.line, e.reason])]); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'skipped-leads.csv'; a.click(); URL.revokeObjectURL(a.href); };
  const sel = (k: 'phone' | 'name' | 'email', label: string) => (
    <Field label={label}><Select value={map[k]} onChange={(e) => setMap({ ...map, [k]: Number(e.target.value) })}><option value={-1}>Not in the file</option>{headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}</Select></Field>
  );
  if (rep) return (
    <div className="card flex flex-col gap-3 p-5">
      <h3 className="font-display text-lg font-bold">Import finished</h3>
      <ul className="grid gap-2 text-sm sm:grid-cols-4"><li className="rounded-lg bg-emerald-50 p-3"><b className="text-xl text-emerald-800">{rep.added}</b><br />new leads</li><li className="rounded-lg bg-sky-50 p-3"><b className="text-xl text-sky-800">{rep.extended}</b><br />already known, updated</li><li className="rounded-lg bg-rose-50 p-3"><b className="text-xl text-rose-800">{rep.invalid}</b><br />skipped</li><li className="rounded-lg bg-amber-50 p-3"><b className="text-xl text-amber-800">{rep.overLimit}</b><br />over plan limit</li></ul>
      {rep.errors.length ? <><ul className="max-h-40 overflow-auto text-xs text-muted">{rep.errors.slice(0, 30).map((e, i) => <li key={i}>Line {e.line}: {e.reason}</li>)}</ul><Button variant="outline" className="w-fit" onClick={errorsCsv}><Download className="size-4" />Download skipped rows</Button></> : null}
      <Button className="w-fit" onClick={() => { setRep(null); setData([]); setHeaders([]); setFile(''); }}>Import another file</Button>
    </div>
  );
  return (
    <div className="card flex flex-col gap-4 p-5">
      <div><h3 className="font-display font-bold">Import leads from a spreadsheet</h3><p className="text-sm text-muted">Save your sheet as CSV (File &gt; Save as &gt; CSV). Phone numbers are cleaned, repeats are removed, and people you already have are updated, not duplicated.</p></div>
      {!file ? (
        <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && canManage) load(f); }} className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-line p-8 text-center">
          <Upload className="size-9 text-brand" /><p className="font-semibold">Drop your CSV here</p>
          <label className={cn('inline-flex min-h-11 cursor-pointer items-center rounded-xl px-5 text-sm font-semibold text-white grad-bg', !canManage && 'pointer-events-none opacity-50')}>Choose a file<input type="file" accept=".csv,.txt,.tsv,text/csv" className="sr-only" aria-label="Choose CSV file" onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ''; }} /></label>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="flex items-center gap-2 text-sm"><FileText className="size-4" /><b>{file}</b> · {data.length.toLocaleString('en-IN')} rows · <span className={valid ? 'text-emerald-700' : 'text-rose-700'}>{valid.toLocaleString('en-IN')} with a usable number</span></p>
          <div className="grid gap-3 sm:grid-cols-3">{sel('phone', 'WhatsApp number column')}{sel('name', 'Name column')}{sel('email', 'Email column')}</div>
          <Field label="Call this list"><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
          <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>These people agreed to receive WhatsApp messages and offers from us (for example they filled a form or told us in the shop). <b>Leave this unticked if you are not sure</b>: they will be reply-only and you can still answer them.</span></label>
          {map.phone < 0 ? <FormError>Choose which column has the WhatsApp number.</FormError> : null}
          {err ? <FormError>{err}</FormError> : null}
          <div className="flex gap-2"><Button variant="ghost" onClick={() => { setFile(''); setData([]); setHeaders([]); }}>Choose another file</Button><Button onClick={run} disabled={busy || map.phone < 0 || valid === 0 || !canManage}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}Import {valid.toLocaleString('en-IN')} leads</Button></div>
        </div>
      )}
      {!file && err ? <FormError>{err}</FormError> : null}
    </div>
  );
}
