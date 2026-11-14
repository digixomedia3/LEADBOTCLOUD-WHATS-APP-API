'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { AlertTriangle, CheckCircle2, Plus, Trash2, Users } from 'lucide-react';
import { LEAD_STATUSES, segmentFilter, type SegmentFilter, type SegmentRule } from '@lbc/shared';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';
import { loadSegment, previewSegment, saveSegment, segmentOptions, type SegmentOptions, type SegmentPreview } from '@/app/(app)/contacts/segments';

type Draft = SegmentRule & { _k: number };
const TYPES: { v: SegmentRule['type']; label: string }[] = [
  { v: 'tag', label: 'Tag' }, { v: 'lead_status', label: 'Lead status' }, { v: 'lead_source', label: 'Lead source' },
  { v: 'last_inbound', label: 'Last message from them' }, { v: 'added', label: 'When added' }, { v: 'campaign', label: 'A previous bulk send' },
];
const OUTCOMES: { v: Extract<SegmentRule, { type: 'campaign' }>['op']; label: string }[] = [
  { v: 'received', label: 'received it' }, { v: 'read', label: 'read it' }, { v: 'replied', label: 'replied to it' },
  { v: 'not_read', label: 'got it but did not read it' }, { v: 'not_replied', label: 'got it but did not reply' }, { v: 'failed', label: 'did not receive it (failed)' },
];
let key = 1;
const blank = (type: SegmentRule['type'], o: SegmentOptions): SegmentRule => {
  switch (type) {
    case 'tag': return { type, op: 'has', value: o.tags[0] ?? '' };
    case 'lead_status': return { type, op: 'is', values: ['new'] };
    case 'lead_source': return { type, op: 'is', sourceId: o.sources[0]?.id ?? '' };
    case 'last_inbound': return { type, op: 'within', days: 30 };
    case 'added': return { type, op: 'within', days: 30 };
    case 'campaign': return { type, op: 'not_read', campaignId: o.campaigns[0]?.id ?? '' };
  }
};

export function SegmentEditor({ open, editId, onClose, onSaved }: { open: boolean; editId: string | null; onClose: () => void; onSaved: (m: string) => void }) {
  const [opts, setOpts] = useState<SegmentOptions>({ campaigns: [], sources: [], tags: [] });
  const [name, setName] = useState('');
  const [match, setMatch] = useState<'all' | 'any'>('all');
  const [rules, setRules] = useState<Draft[]>([]);
  const [prev, setPrev] = useState<SegmentPreview | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    setError(''); setPrev(null);
    void (async () => {
      const o = await segmentOptions(); setOpts(o);
      if (editId) {
        const r = await loadSegment(editId);
        if (r.ok) { setName(r.data.name); setMatch(r.data.filter.match); setRules(r.data.filter.rules.map((x) => ({ ...x, _k: key++ }))); }
        else setError(r.error);
      } else { setName(''); setMatch('all'); setRules([{ ...blank('tag', o), _k: key++ }]); }
    })();
  }, [open, editId]);

  const filter: SegmentFilter = useMemo(() => ({ match, rules: rules.map(({ _k, ...r }) => { void _k; return r as SegmentRule; }) }), [match, rules]);
  const valid = useMemo(() => segmentFilter.safeParse(filter).success, [filter]);

  useEffect(() => {
    if (!open || !valid) { setPrev(null); return; }
    let live = true;
    const t = setTimeout(() => { void previewSegment(filter).then((r) => { if (live && r.ok) setPrev(r.data); }); }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [open, valid, filter]);

  const set = (k: number, patch: Partial<SegmentRule>) => setRules((rs) => rs.map((r) => (r._k === k ? ({ ...r, ...patch } as Draft) : r)));
  const retype = (k: number, type: SegmentRule['type']) => setRules((rs) => rs.map((r) => (r._k === k ? { ...blank(type, opts), _k: k } : r)));
  const save = () => start(async () => {
    setError('');
    const r = await saveSegment({ id: editId ?? undefined, name, filter });
    if (!r.ok) { setError(r.error); return; }
    onSaved(editId ? 'Segment saved.' : 'Segment created.'); onClose();
  });

  return (
    <Modal open={open} onClose={onClose} title={editId ? 'Edit segment' : 'New segment'} wide>
      <div className="flex flex-col gap-4">
        <FormError>{error}</FormError>
        <Field label="Segment name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Did not read November offer" maxLength={80} autoFocus /></Field>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">People who match</span>
          <Select aria-label="All or any" className="w-auto" value={match} onChange={(e) => setMatch(e.target.value as 'all' | 'any')}><option value="all">all of these rules</option><option value="any">any of these rules</option></Select>
        </div>
        <ul className="flex flex-col gap-2">
          {rules.map((r) => (
            <li key={r._k} className="flex flex-col gap-2 rounded-xl border border-line p-3 sm:flex-row sm:items-center">
              <Select aria-label="Rule type" className="sm:w-52" value={r.type} onChange={(e) => retype(r._k, e.target.value as SegmentRule['type'])}>{TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}</Select>
              <RuleControls r={r} opts={opts} set={(p) => set(r._k, p)} />
              <Button variant="ghost" size="icon" aria-label="Remove rule" onClick={() => setRules((rs) => rs.filter((x) => x._k !== r._k))} disabled={rules.length === 1}><Trash2 className="size-4" /></Button>
            </li>
          ))}
        </ul>
        <div><Button variant="outline" size="sm" disabled={rules.length >= 15} onClick={() => setRules((rs) => [...rs, { ...blank('tag', opts), _k: key++ }])}><Plus className="size-4" />Add a rule</Button></div>

        <div className={cn('rounded-2xl border p-4 text-sm', valid ? 'border-line' : 'border-amber/40 bg-amber/5')} aria-live="polite">
          {!valid ? <p className="flex gap-2 text-amber"><AlertTriangle className="mt-0.5 size-4 shrink-0" />Finish every rule to see who this picks.</p> : !prev ? <p className="text-muted">Counting…</p> : (
            <>
              <p className="flex items-center gap-2 font-bold"><Users className="size-4 text-brand" />{prev.total.toLocaleString('en-IN')} {prev.total === 1 ? 'person matches' : 'people match'} right now</p>
              <p className="mt-1 flex items-center gap-2"><CheckCircle2 className="size-4 text-brand" />{prev.sendable.toLocaleString('en-IN')} can be sent a promotion</p>
              {prev.optedOut + prev.noRecord > 0 ? <p className="mt-1 flex gap-2 text-amber"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{prev.optedOut} opted out and {prev.noRecord} with no permission record are skipped automatically at send time.</p> : null}
              {prev.sample.length ? <p className="mt-2 text-xs text-muted">For example: {prev.sample.join(', ')}</p> : null}
            </>
          )}
          <p className="mt-2 text-xs text-muted">A segment only chooses who to consider. People who opted out are never sent a message, whatever the rules say. The list updates by itself, so it is re-read each time you send.</p>
        </div>
        <div className="flex gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button className="flex-1" disabled={pending || !valid || name.trim().length < 2} onClick={save}>{editId ? 'Save segment' : 'Create segment'}</Button></div>
      </div>
    </Modal>
  );
}

function RuleControls({ r, opts, set }: { r: SegmentRule; opts: SegmentOptions; set: (p: Partial<SegmentRule>) => void }) {
  const num = (v: number | undefined, on: (n: number) => void) => <Input aria-label="Number of days" className="w-24" inputMode="numeric" value={v ?? ''} onChange={(e) => on(Math.min(3650, Number(e.target.value.replace(/\D/g, '')) || 0))} />;
  switch (r.type) {
    case 'tag': return (<><Select aria-label="Has or has not" className="sm:w-40" value={r.op} onChange={(e) => set({ op: e.target.value as 'has' })}><option value="has">has the tag</option><option value="not_has">does not have the tag</option></Select>
      <Input aria-label="Tag" list="seg-tags" className="min-w-0 flex-1" value={r.value} onChange={(e) => set({ value: e.target.value })} placeholder="vip" maxLength={60} /><datalist id="seg-tags">{opts.tags.map((t) => <option key={t} value={t} />)}</datalist></>);
    case 'lead_status': return (<><Select aria-label="Is or is not" className="sm:w-44" value={r.op} onChange={(e) => set({ op: e.target.value as 'is' })}><option value="is">has a lead that is</option><option value="is_not">has no lead that is</option></Select>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">{LEAD_STATUSES.map((s) => { const on = r.values.includes(s); return <button key={s} type="button" aria-pressed={on} onClick={() => set({ values: on ? r.values.filter((x) => x !== s) : [...r.values, s] })} className={cn('min-h-9 rounded-full px-3 text-xs font-semibold capitalize', on ? 'bg-brand text-white' : 'bg-ink/5')}>{s}</button>; })}</div></>);
    case 'lead_source': return (<><Select aria-label="Came from or not" className="sm:w-44" value={r.op} onChange={(e) => set({ op: e.target.value as 'is' })}><option value="is">came from</option><option value="is_not">did not come from</option></Select>
      <Select aria-label="Lead source" className="min-w-0 flex-1" value={r.sourceId} onChange={(e) => set({ sourceId: e.target.value })}>{opts.sources.length === 0 ? <option value="">No lead sources yet</option> : null}{opts.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></>);
    case 'last_inbound': return (<><Select aria-label="When" className="sm:w-48" value={r.op} onChange={(e) => set({ op: e.target.value as 'within', days: r.days ?? 30 })}><option value="within">messaged you in the last</option><option value="not_within">has not messaged you in the last</option><option value="never">has never messaged you</option></Select>
      {r.op !== 'never' ? <>{num(r.days, (n) => set({ days: n }))}<span className="text-sm text-muted">days</span></> : null}</>);
    case 'added': return (<><Select aria-label="When" className="sm:w-48" value={r.op} onChange={(e) => set({ op: e.target.value as 'within' })}><option value="within">was added in the last</option><option value="before">was added more than</option></Select>{num(r.days, (n) => set({ days: n }))}<span className="text-sm text-muted">{r.op === 'before' ? 'days ago' : 'days'}</span></>);
    case 'campaign': return (<><Select aria-label="Bulk send" className="min-w-0 flex-1" value={r.campaignId} onChange={(e) => set({ campaignId: e.target.value })}>{opts.campaigns.length === 0 ? <option value="">No bulk sends yet</option> : null}{opts.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
      <Select aria-label="Outcome" className="sm:w-56" value={r.op} onChange={(e) => set({ op: e.target.value as 'read' })}>{OUTCOMES.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</Select></>);
  }
}
