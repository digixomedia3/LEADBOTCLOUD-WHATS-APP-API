'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import Papa from 'papaparse';
import { AlertTriangle, CheckCircle2, ClipboardPaste, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { CONSENT_SOURCES } from '@lbc/shared';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { buildPreview, parsePasted, suggestMapping, type Field as ColField } from '@/lib/contacts/import';
import { importContacts, type GroupRow, type ImportReport } from '@/app/(app)/contacts/actions';
import { cn } from '@/lib/utils';

const FIELD_LABEL: Record<ColField, string> = { phone: 'Phone number', name: 'Name', email: 'Email', tags: 'Tags', ignore: 'Skip this column' };
const MAX_BYTES = 5 * 1024 * 1024;

export function ImportWizard({ open, onClose, groups, onDone }: { open: boolean; onClose: () => void; groups: GroupRow[]; onDone: (msg: string) => void }) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColField[]>([]);
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState('');
  const [source, setSource] = useState<string>(CONSENT_SOURCES[0]);
  const [consent, setConsent] = useState(false);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [newGroup, setNewGroup] = useState('');
  const [update, setUpdate] = useState(true);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pending, start] = useTransition();
  const drop = useRef<HTMLInputElement>(null);

  function reset() { setStep(1); setMode('file'); setFileName(''); setHeaders([]); setRows([]); setMapping([]); setPasted(''); setError(''); setConsent(false); setGroupIds([]); setNewGroup(''); setReport(null); }
  function close() { reset(); onClose(); }

  function loadFile(file: File) {
    setError('');
    if (file.size > MAX_BYTES) { setError('This file is larger than 5 MB. Split it into smaller files and try again.'); return; }
    if (!/\.(csv|txt|tsv)$/i.test(file.name)) { setError('Please choose a CSV file. In Excel or Google Sheets use File > Save as > CSV.'); return; }
    Papa.parse<string[]>(file, {
      skipEmptyLines: 'greedy', encoding: 'UTF-8',
      complete: (res) => {
        const all = res.data as string[][];
        if (all.length < 2) { setError('The file needs a header row and at least one customer.'); return; }
        const [h, ...body] = all;
        setFileName(file.name); setHeaders(h!.map((x) => String(x ?? ''))); setRows(body);
        setMapping(suggestMapping(h!.map(String), body)); setStep(2);
      },
      error: () => setError('We could not read this file. Save it as CSV (UTF-8) and try again.'),
    });
  }

  function usePasted() {
    const parsed = parsePasted(pasted);
    if (!parsed.length) { setError('Paste at least one phone number.'); return; }
    setFileName('Pasted numbers'); setHeaders(['Name', 'Phone']); setRows(parsed); setMapping(['name', 'phone']); setError(''); setStep(3);
  }

  const preview = useMemo(() => (rows.length ? buildPreview(rows, mapping, mode === 'paste' ? 1 : 2) : null), [rows, mapping, mode]);
  const hasPhone = mapping.includes('phone');

  function run() {
    if (!preview) return;
    setError('');
    start(async () => {
      const r = await importContacts({ rows: preview.rows, source, consent, groupIds, newGroup, updateExisting: update, fileName });
      if (!r.ok) { setError(r.error); return; }
      setReport(r.data); setStep(5);
      onDone(`Import finished: ${r.data.added} added, ${r.data.updated} updated.`);
    });
  }

  function downloadErrors() {
    if (!report) return;
    const csv = ['Line,Reason', ...report.errors.map((e) => `${e.line},"${e.reason.replace(/"/g, '""')}"`)].join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'skipped-rows.csv'; a.click(); URL.revokeObjectURL(a.href);
  }

  const steps = ['Upload', 'Match', 'Check', 'Permission', 'Done'];
  return (
    <Modal open={open} onClose={close} title="Import contacts" wide>
      <ol className="mb-5 grid grid-cols-5 gap-1.5 text-center text-[11px] font-semibold" aria-label="Steps">
        {steps.map((s, i) => <li key={s} className={cn('rounded-full px-1 py-1.5', i + 1 === step ? 'grad-bg text-white' : i + 1 < step ? 'bg-brand/15 text-brand' : 'bg-ink/5 text-muted')}>{i + 1}. {s}</li>)}
      </ol>
      <FormError>{error}</FormError>

      {step === 1 ? (
        <div className="mt-3 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2" role="tablist">
            {(['file', 'paste'] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setError(''); }} className={cn('flex min-h-12 items-center justify-center gap-2 rounded-xl border text-sm font-semibold', mode === m ? 'border-brand bg-brand/10 text-brand' : 'border-line')}>
                {m === 'file' ? <><FileSpreadsheet className="size-4" />Upload CSV</> : <><ClipboardPaste className="size-4" />Paste numbers</>}
              </button>
            ))}
          </div>
          {mode === 'file' ? (
            <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) loadFile(f); }}
              className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-line p-8 text-center">
              <Upload className="size-9 text-brand" />
              <p className="font-semibold">Drop your CSV here</p>
              <p className="max-w-sm text-sm text-muted">Column names in English or Hindi both work. We clean phone numbers and remove duplicates. From Excel: File &gt; Save as &gt; CSV.</p>
              <input ref={drop} type="file" accept=".csv,.txt,.tsv,text/csv" className="sr-only" aria-label="Choose CSV file" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} />
              <Button onClick={() => drop.current?.click()}>Choose a file</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Field label="One customer per line" hint="Just a number, or Name, number"><Textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={8} placeholder={'98765 43210\nAsha Verma, 98765 43211'} /></Field>
              <Button onClick={usePasted}>Continue</Button>
            </div>
          )}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="mt-3 flex flex-col gap-4">
          <p className="text-sm text-muted">We matched the columns of <strong className="text-ink">{fileName}</strong> ({rows.length.toLocaleString('en-IN')} rows). Check them.</p>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[34rem] text-sm">
              <thead><tr>{headers.map((h, i) => (
                <th key={i} className="min-w-36 border-b border-line bg-card2 p-2 text-left align-top">
                  <span className="mb-1 block truncate text-xs text-muted">{h || `Column ${i + 1}`}</span>
                  <Select aria-label={`What is ${h || `column ${i + 1}`}?`} value={mapping[i]} onChange={(e) => setMapping(mapping.map((m, j) => (j === i ? (e.target.value as ColField) : m)))} className="min-h-10 text-sm">
                    {(Object.keys(FIELD_LABEL) as ColField[]).map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
                  </Select>
                </th>))}</tr></thead>
              <tbody>{rows.slice(0, 5).map((r, i) => <tr key={i} className="border-b border-line last:border-0">{headers.map((_, c) => <td key={c} className="max-w-48 truncate p-2">{r[c]}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {!hasPhone ? <FormError>Choose which column is the phone number.</FormError> : null}
          <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(1)}>Back</Button><Button className="flex-1" disabled={!hasPhone} onClick={() => setStep(3)}>Check my data</Button></div>
        </div>
      ) : null}

      {step === 3 && preview ? (
        <div className="mt-3 flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            {[['Ready', preview.valid, 'text-brand'], ['Problems', preview.invalid, 'text-rose'], ['Repeated', preview.duplicates, 'text-amber']].map(([k, v, c]) => (
              <div key={k as string} className="rounded-2xl border border-line p-3"><p className={cn('font-display text-3xl font-extrabold', c as string)}>{(v as number).toLocaleString('en-IN')}</p><p className="text-xs text-muted">{k as string}</p></div>
            ))}
          </div>
          {preview.invalid + preview.duplicates + preview.badEmails > 0 ? (
            <div className="max-h-52 overflow-y-auto rounded-xl border border-line text-sm">
              {preview.rows.filter((r) => r.error || r.duplicateOf !== undefined || r.badEmail !== undefined).slice(0, 50).map((r) => (
                <p key={r.line} className="flex gap-2 border-b border-line px-3 py-2 last:border-0"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber" /><span><strong>Line {r.line}:</strong> {r.error ?? (r.duplicateOf !== undefined ? `Same number as line ${r.duplicateOf}. It will be skipped.` : `The email "${r.badEmail}" does not look right. The contact is added without it.`)}</span></p>
              ))}
            </div>
          ) : <p className="flex items-center gap-2 text-sm text-brand"><CheckCircle2 className="size-5" />Everything looks good.</p>}
          <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(mode === 'paste' ? 1 : 2)}>Back</Button><Button className="flex-1" disabled={preview.valid === 0} onClick={() => setStep(4)}>Continue with {preview.valid.toLocaleString('en-IN')} contacts</Button></div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="mt-3 flex flex-col gap-4">
          <Field label="Where did these customers agree to get messages?"><Select value={source} onChange={(e) => setSource(e.target.value)}>{CONSENT_SOURCES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
          <fieldset className="flex flex-col gap-2"><legend className="mb-1 text-sm font-semibold">Put them in a group (optional)</legend>
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <label key={g.id} className={cn('flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm font-medium', groupIds.includes(g.id) ? 'border-brand bg-brand/10 text-brand' : 'border-line')}>
                  <input type="checkbox" className="sr-only" checked={groupIds.includes(g.id)} onChange={() => setGroupIds(groupIds.includes(g.id) ? groupIds.filter((x) => x !== g.id) : [...groupIds, g.id])} />{g.name}
                </label>))}
            </div>
            <Input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="Or create a new group, for example: November list" maxLength={80} />
          </fieldset>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} className="size-5 accent-[var(--brand)]" />Update contacts I already have (add new tags and names)</label>
          <label className="flex min-h-11 items-start gap-3 rounded-xl border border-brand/40 bg-brand/5 p-3 text-sm font-medium"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-5 accent-[var(--brand)]" />These customers agreed to receive WhatsApp messages from my business. I can show proof if asked.</label>
          <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(3)}>Back</Button><Button className="flex-1" disabled={!consent || pending} onClick={run}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}Import now</Button></div>
        </div>
      ) : null}

      {step === 5 && report ? (
        <div className="mt-3 flex flex-col items-center gap-4 text-center">
          <CheckCircle2 className="size-14 text-brand" />
          <h3 className="font-display text-2xl font-extrabold">Import finished</h3>
          <div className="flex flex-wrap justify-center gap-2 text-sm font-semibold">
            <span className="rounded-full bg-brand/15 px-3 py-1 text-brand">{report.added.toLocaleString('en-IN')} added</span>
            <span className="rounded-full bg-indigo/15 px-3 py-1 text-indigo">{report.updated.toLocaleString('en-IN')} updated</span>
            {report.skippedExisting ? <span className="rounded-full bg-ink/10 px-3 py-1">{report.skippedExisting} already existed</span> : null}
            {report.invalid + report.duplicatesInFile + report.overLimit ? <span className="rounded-full bg-amber/15 px-3 py-1 text-amber">{report.invalid + report.duplicatesInFile + report.overLimit} skipped</span> : null}
          </div>
          {report.overLimit ? <FormError>{report.overLimit} contacts were not added because you reached your plan limit.</FormError> : null}
          <div className="flex flex-wrap justify-center gap-2">{report.errors.length ? <Button variant="outline" onClick={downloadErrors}>Download skipped rows</Button> : null}<Button onClick={close}>Done</Button></div>
        </div>
      ) : null}
    </Modal>
  );
}
