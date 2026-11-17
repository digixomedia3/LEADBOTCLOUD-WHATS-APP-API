'use client';

import { useEffect, useMemo } from 'react';
import { FlaskConical } from 'lucide-react';
import { variablesIn } from '@lbc/shared';
import { isTrackedButtonValue } from '@lbc/shared/tracked-links';
import { Field, Input, Select } from '@/components/ui/form';
import type { TemplateRow } from '@/app/(app)/templates/actions';

export interface AbDraft { on: boolean; templateId: string; vars: string[]; percentB: number }
export const AB_OFF: AbDraft = { on: false, templateId: '', vars: [], percentB: 50 };

const kind = (t: TemplateRow, appUrl: string) => ({
  copy: t.buttons.some((b) => b.type === 'copy_code'), countdown: !!t.offer?.hasExpiration, tracked: t.buttons.some((b) => b.type === 'url' && isTrackedButtonValue(b.value, appUrl)),
});

/** Templates that can be version B for this version A: another approved template of the same category and the same kind of offer and button. */
export function comparableTemplates(a: TemplateRow | undefined, all: TemplateRow[], appUrl: string): TemplateRow[] {
  if (!a) return [];
  const ka = kind(a, appUrl);
  return all.filter((t) => t.id !== a.id && t.status === 'approved' && t.category === a.category && (() => { const k = kind(t, appUrl); return k.copy === ka.copy && k.countdown === ka.countdown && k.tracked === ka.tracked; })());
}

export const abReady = (ab: AbDraft, b: TemplateRow | undefined) => !ab.on || (!!b && ab.vars.length === new Set(variablesIn(b.body)).size && ab.vars.every((v) => v.trim().length > 0) && ab.percentB >= 10 && ab.percentB <= 90);

/** "Test two versions": the same people are split at random, and the report says which version did better. */
export function AbTestFields({ a, all, appUrl, value, onChange, repeats }: { a: TemplateRow | undefined; all: TemplateRow[]; appUrl: string; value: AbDraft; onChange: (v: AbDraft) => void; repeats: boolean }) {
  const options = useMemo(() => comparableTemplates(a, all, appUrl), [a, all, appUrl]);
  const b = options.find((t) => t.id === value.templateId);
  const needed = b ? new Set(variablesIn(b.body)).size : 0;

  // Keep the second template valid when the first changes, and keep one box per blank.
  useEffect(() => {
    if (!value.on) return;
    if (value.templateId && !options.some((t) => t.id === value.templateId)) { onChange({ ...value, templateId: '', vars: [] }); return; }
    if (b && value.vars.length !== needed) onChange({ ...value, vars: Array.from({ length: needed }, (_, i) => value.vars[i] ?? (i === 0 ? '@name' : '')) });
  }, [value, options, b, needed, onChange]);

  if (!a) return null;
  return (
    <div className="rounded-xl border border-line p-3">
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" className="size-4" checked={value.on} disabled={options.length === 0} onChange={(e) => onChange({ ...value, on: e.target.checked, templateId: e.target.checked ? value.templateId || options[0]?.id || '' : '' })} /><FlaskConical className="size-4 text-indigo" aria-hidden />Test two versions</label>
      {options.length === 0 ? <p className="mt-1 text-xs text-muted">To test, you need a second approved template of the same kind: both promotional or both updates, with the same kind of offer and website button.</p> : null}
      {repeats && value.on ? <p className="mt-1 text-xs text-rose" role="alert">A test cannot repeat. Set “Repeat” to once.</p> : null}
      {value.on ? (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-xs text-muted">People are split at random. Some get this template (version A), the rest get the second one (version B). The report then shows which gets more reads and replies, and only calls a winner when the difference is real.</p>
          <Field label="Second template (version B)"><Select value={value.templateId} onChange={(e) => onChange({ ...value, templateId: e.target.value, vars: [] })}>{options.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          {b && needed > 0 ? (
            <div className="flex flex-col gap-2 rounded-lg bg-card2 p-2.5">
              <p className="text-xs font-semibold">Blanks for version B</p>
              {value.vars.map((val, i) => {
                const preset = ['@name', '@fullname', '@phone'].includes(val);
                return (
                  <div key={i} className="grid gap-1.5">
                    <label className="text-xs font-semibold text-muted">{`{{${i + 1}}}`}</label>
                    <Select aria-label={`Version B blank ${i + 1}`} value={preset ? val : 'fixed'} onChange={(e) => onChange({ ...value, vars: value.vars.map((x, j) => (j === i ? (e.target.value === 'fixed' ? '' : e.target.value) : x)) })}>
                      <option value="@name">Customer’s first name</option><option value="@fullname">Customer’s full name</option><option value="@phone">Customer’s phone number</option><option value="fixed">Same text for everyone</option>
                    </Select>
                    {!preset ? <Input aria-label={`Version B text ${i + 1}`} value={val} maxLength={200} onChange={(e) => onChange({ ...value, vars: value.vars.map((x, j) => (j === i ? e.target.value : x)) })} placeholder="e.g. 20% off until Sunday" /> : null}
                  </div>);
              })}
            </div>) : null}
          <Field label={`Share of people who get version B: ${value.percentB}%`} hint="Half and half gives the clearest answer. The rest get version A."><input type="range" min={10} max={90} step={5} value={value.percentB} aria-label="Share of people who get version B" className="w-full" onChange={(e) => onChange({ ...value, percentB: Number(e.target.value) })} /></Field>
        </div>) : null}
    </div>
  );
}
