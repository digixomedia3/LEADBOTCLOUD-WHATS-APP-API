'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { ArrowDown, ArrowUp, Clock, Filter, Loader2, MessageSquare, Pause, Play, Plus, Route, Tag, Trash2, UserCheck, Users, X } from 'lucide-react';
import { CHECKS, CHECK_LABEL, MAX_STEPS, checkNeedsTag, describeMinutes, describeStep, describeTrigger, journeyProblem, totalWaitMinutes, type Check, type JourneyStep, type JourneyTrigger } from '@lbc/shared/journeys';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';
import { deleteJourney, enrollGroup, listRuns, saveJourney, setJourneyStatus, stopAllRuns, type JourneyRow, type RunRow, type TemplateChoice, type Teammate } from '@/app/(app)/journeys/actions';

interface Group { id: string; name: string; count: number }
interface Source { id: string; name: string }
const num = (n: number) => n.toLocaleString('en-IN');
const STATUS: Record<string, { label: string; cls: string }> = { draft: { label: 'Not started', cls: 'bg-ink/10' }, active: { label: 'Running', cls: 'bg-brand/15 text-brand' }, paused: { label: 'Paused', cls: 'bg-amber/15 text-amber' } };
const UNITS = [{ label: 'minutes', mult: 1 }, { label: 'hours', mult: 60 }, { label: 'days', mult: 1440 }] as const;

export function JourneysView({ initial, templates, groups, sources, people, canEdit, live }: { initial: JourneyRow[]; templates: TemplateChoice[]; groups: Group[]; sources: Source[]; people: Teammate[]; canEdit: boolean; live: boolean }) {
  const [list, setList] = useState(initial);
  const [editing, setEditing] = useState<JourneyRow | 'new' | null>(null);
  const [detail, setDetail] = useState<JourneyRow | null>(null);
  const [toast, setToast] = useState('');
  const [pending, start] = useTransition();
  const names = useMemo(() => Object.fromEntries(templates.map((t) => [t.id, t.name])), [templates]);
  const who = useMemo(() => Object.fromEntries(people.map((p) => [p.userId, p.name])), [people]);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4000); };
  const reload = async () => { const { listJourneys } = await import('@/app/(app)/journeys/actions'); setList(await listJourneys()); };
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) => start(async () => { const r = await fn(); if (!r.ok) flash(r.error ?? 'Something went wrong.'); else if (ok) flash(ok); await reload(); });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="font-display text-2xl font-bold">Journeys</h1><p className="text-sm text-muted">A few messages sent over days, one after the other, stopping the moment a customer replies.</p></div>
        {canEdit ? <Button onClick={() => setEditing('new')}><Plus className="size-4" />New journey</Button> : null}
      </header>
      {!live ? <p className="rounded-xl bg-amber/10 p-3 text-sm text-amber">Connect your WhatsApp number in Settings before starting a journey. Until then you can build and save them.</p> : null}

      {list.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-8 text-center">
          <Route className="size-10 text-brand" aria-hidden />
          <p className="font-display text-lg font-bold">No journeys yet</p>
          <p className="max-w-md text-sm text-muted">Example: when someone fills your form, send a welcome message, wait two days, then send a follow-up only if they have not replied.</p>
          {canEdit ? <Button onClick={() => setEditing('new')}><Plus className="size-4" />Build your first journey</Button> : null}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((j) => (
            <li key={j.id} className="card flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0"><button type="button" onClick={() => setDetail(j)} className="text-left font-display text-lg font-bold underline-offset-2 hover:underline">{j.name}</button>
                  <p className="text-xs text-muted">{describeTrigger(j.trigger)} · {j.steps.length} step{j.steps.length === 1 ? '' : 's'}{totalWaitMinutes(j.steps) ? ` · about ${describeMinutes(totalWaitMinutes(j.steps))} long` : ''}</p></div>
                <span className={cn('rounded-full px-2.5 py-1 text-xs font-bold', STATUS[j.status]!.cls)}>{STATUS[j.status]!.label}</span>
              </div>
              <ol className="flex flex-wrap gap-1.5 text-xs" aria-label="Steps">{j.steps.map((s, i) => <li key={i} className="rounded-full bg-card2 px-2.5 py-1">{describeStep(s, { templates: names, people: who })}</li>)}</ol>
              <p className="text-sm text-muted"><strong className="text-ink">{num(j.counts.active)}</strong> in progress · <strong className="text-ink">{num(j.counts.completed)}</strong> finished · <strong className="text-ink">{num(j.counts.stopped)}</strong> stopped{j.counts.failed ? <> · <strong className="text-rose">{num(j.counts.failed)}</strong> had a problem</> : null}</p>
              {canEdit ? (
                <div className="flex flex-wrap gap-2">
                  {j.status === 'active'
                    ? <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => setJourneyStatus(j.id, 'paused'), 'Paused. Nobody moves until you start it again.')}><Pause className="size-3.5" />Pause</Button>
                    : <Button size="sm" disabled={pending} onClick={() => act(() => setJourneyStatus(j.id, 'active'), 'Started.')}><Play className="size-3.5" />Start</Button>}
                  {j.status === 'active' ? <Button size="sm" variant="outline" onClick={() => setDetail(j)}><Users className="size-3.5" />Add a group</Button> : <Button size="sm" variant="outline" onClick={() => setEditing(j)}>Edit</Button>}
                  {j.status !== 'active' ? <Button size="sm" variant="outline" disabled={pending} onClick={() => { if (confirm(`Delete “${j.name}”? People already in it stop.`)) act(() => deleteJourney(j.id), 'Deleted.'); }}><Trash2 className="size-3.5" />Delete</Button> : null}
                </div>) : null}
            </li>))}
        </ul>)}

      {editing ? <Builder initial={editing === 'new' ? null : editing} templates={templates} sources={sources} people={people} onClose={() => setEditing(null)} onSaved={async (m) => { setEditing(null); flash(m); await reload(); }} /> : null}
      {detail ? <Detail journey={detail} groups={groups} canEdit={canEdit} onClose={() => setDetail(null)} flash={flash} reload={reload} names={names} who={who} /> : null}
      {toast ? <div role="status" className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-bg shadow-xl md:bottom-8">{toast}</div> : null}
    </div>
  );
}

const blank = (type: JourneyStep['type'], templates: TemplateChoice[], people: Teammate[] = []): JourneyStep => type === 'wait' ? { type: 'wait', minutes: 1440 } : type === 'add_tag' ? { type: 'add_tag', tag: '' } : type === 'only_if' ? { type: 'only_if', check: 'not_read_last' } : type === 'assign' ? { type: 'assign', userId: people[0]?.userId ?? '' } : { type: 'send_template', templateId: templates.find((t) => t.usable)?.id ?? '', varMap: [] };
const STEP_LABEL: Record<JourneyStep['type'], string> = { wait: 'Wait', add_tag: 'Add a tag', send_template: 'Send a message', only_if: 'Only continue if…', assign: 'Give the chat to a teammate' };

function Builder({ initial, templates, sources, people, onClose, onSaved }: { initial: JourneyRow | null; templates: TemplateChoice[]; sources: Source[]; people: Teammate[]; onClose: () => void; onSaved: (m: string) => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [trigger, setTrigger] = useState<JourneyTrigger>(initial?.trigger ?? { type: 'manual' });
  const [steps, setSteps] = useState<JourneyStep[]>(initial?.steps ?? [blank('send_template', templates)]);
  const [stopOnReply, setStopOnReply] = useState(initial?.stopOnReply ?? true);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const usable = templates.filter((t) => t.usable);
  const tplById = useMemo(() => Object.fromEntries(templates.map((t) => [t.id, t])), [templates]);
  const set = (i: number, s: JourneyStep) => setSteps((a) => a.map((x, j) => (j === i ? s : x)));
  const move = (i: number, d: -1 | 1) => setSteps((a) => { const b = [...a], k = i + d; if (k < 0 || k >= b.length) return a; [b[i], b[k]] = [b[k]!, b[i]!]; return b; });
  const problem = journeyProblem(steps);

  function pickTemplate(i: number, id: string) { const t = tplById[id]; set(i, { type: 'send_template', templateId: id, varMap: Array.from({ length: t?.blanks ?? 0 }, (_, k) => (k === 0 ? '@name' : '')) }); }
  function submit() {
    setError('');
    start(async () => { const r = await saveJourney({ id: initial?.id, name, trigger, steps, stopOnReply }); if (!r.ok) setError(r.error); else onSaved(initial ? 'Saved.' : 'Journey saved. Press Start when you are ready.'); });
  }

  return (
    <Modal open onClose={onClose} title={initial ? 'Edit journey' : 'New journey'}>
      <div className="mt-2 flex flex-col gap-4">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Welcome new leads" /></Field>
        <Field label="Who goes in">
          <Select value={trigger.type === 'lead_created' ? (trigger.sourceId ?? 'any') : trigger.type === 'tag_added' ? 'tag' : 'manual'} onChange={(e) => { const v = e.target.value; setTrigger(v === 'manual' ? { type: 'manual' } : v === 'tag' ? { type: 'tag_added', tag: trigger.type === 'tag_added' ? trigger.tag : '' } : v === 'any' ? { type: 'lead_created' } : { type: 'lead_created', sourceId: v }); }}>
            <option value="manual">People I choose (I add a group)</option>
            <option value="any">Every new lead, from any source</option>
            <option value="tag">Everyone who gets a tag</option>
            {sources.map((s) => <option key={s.id} value={s.id}>New leads from: {s.name}</option>)}
          </Select>
        </Field>
        {trigger.type === 'tag_added' ? <Field label="The tag" hint="Anyone who has it, now or later, joins once. Removing and adding the tag again does not start it twice."><Input aria-label="The tag" value={trigger.tag} maxLength={40} placeholder="e.g. interested" onChange={(e) => setTrigger({ type: 'tag_added', tag: e.target.value })} /></Field> : null}
        <fieldset className="flex flex-col gap-2"><legend className="mb-1 text-sm font-semibold">Steps</legend>
          {steps.map((s, i) => (
            <div key={i} className="rounded-xl border border-line p-3">
              <div className="mb-2 flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-xs font-bold text-muted">{s.type === 'wait' ? <Clock className="size-3.5" /> : s.type === 'add_tag' ? <Tag className="size-3.5" /> : s.type === 'only_if' ? <Filter className="size-3.5" /> : s.type === 'assign' ? <UserCheck className="size-3.5" /> : <MessageSquare className="size-3.5" />}Step {i + 1}: {STEP_LABEL[s.type]}</span>
                <span className="flex gap-1">
                  <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="flex size-9 items-center justify-center rounded-lg hover:bg-ink/5 disabled:opacity-30"><ArrowUp className="size-4" /></button>
                  <button type="button" aria-label="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)} className="flex size-9 items-center justify-center rounded-lg hover:bg-ink/5 disabled:opacity-30"><ArrowDown className="size-4" /></button>
                  <button type="button" aria-label="Remove step" onClick={() => setSteps((a) => a.filter((_, j) => j !== i))} className="flex size-9 items-center justify-center rounded-lg hover:bg-ink/5"><X className="size-4" /></button></span></div>
              {s.type === 'wait' ? <WaitEditor minutes={s.minutes} onChange={(m) => set(i, { type: 'wait', minutes: m })} /> : null}
              {s.type === 'add_tag' ? <Input aria-label="Tag" value={s.tag} maxLength={40} placeholder="e.g. welcomed" onChange={(e) => set(i, { type: 'add_tag', tag: e.target.value })} /> : null}
              {s.type === 'only_if' ? (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-muted">If this is not true for the person, their journey ends here and nothing after it is sent.</p>
                  <Select aria-label="Check" value={s.check} onChange={(e) => { const c = e.target.value as Check; set(i, checkNeedsTag(c) ? { type: 'only_if', check: c, tag: s.tag ?? '' } : { type: 'only_if', check: c }); }}>
                    {CHECKS.map((c) => <option key={c} value={c}>The person {CHECK_LABEL[c]}</option>)}
                  </Select>
                  {checkNeedsTag(s.check) ? <Input aria-label="Tag to check" value={s.tag ?? ''} maxLength={40} placeholder="e.g. interested" onChange={(e) => set(i, { type: 'only_if', check: s.check, tag: e.target.value })} /> : <p className="text-xs text-muted">This looks at the last message this journey sent them. Put a wait before it, so they have time to read.</p>}
                </div>) : null}
              {s.type === 'assign' ? (
                <div className="flex flex-col gap-2">
                  <Select aria-label="Teammate" value={s.userId} onChange={(e) => set(i, { type: 'assign', userId: e.target.value })}>
                    {!s.userId ? <option value="">Choose a teammate</option> : null}
                    {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                  </Select>
                  <p className="text-xs text-muted">Only if nobody has taken the chat yet. A chat someone is already working is never taken away.</p>
                </div>) : null}
              {s.type === 'send_template' ? (
                <div className="flex flex-col gap-2">
                  <Select aria-label="Template" value={s.templateId} onChange={(e) => pickTemplate(i, e.target.value)}>
                    {!s.templateId ? <option value="">Choose a template</option> : null}
                    {templates.map((t) => <option key={t.id} value={t.id} disabled={!t.usable}>{t.name}{t.usable ? '' : ' (cannot be used here)'}</option>)}
                  </Select>
                  {tplById[s.templateId] && !tplById[s.templateId]!.usable ? <p className="text-xs text-amber" role="alert">{tplById[s.templateId]!.why}</p> : null}
                  {tplById[s.templateId] ? <p className="rounded-lg bg-card2 p-2 text-xs text-muted">{tplById[s.templateId]!.body}</p> : null}
                  {s.varMap.map((v, k) => (
                    <Field key={k} label={`Fill in {{${k + 1}}}`}><Select value={['@name', '@fullname', '@phone'].includes(v) ? v : 'text'} onChange={(e) => set(i, { ...s, varMap: s.varMap.map((x, y) => (y === k ? (e.target.value === 'text' ? '' : e.target.value) : x)) })}>
                      <option value="@name">Customer’s first name</option><option value="@fullname">Customer’s full name</option><option value="@phone">Customer’s phone number</option><option value="text">Same text for everyone</option></Select>
                      {!['@name', '@fullname', '@phone'].includes(v) ? <Input aria-label={`Text for {{${k + 1}}}`} className="mt-1" value={v} maxLength={200} onChange={(e) => set(i, { ...s, varMap: s.varMap.map((x, y) => (y === k ? e.target.value : x)) })} /> : null}</Field>))}
                </div>) : null}
            </div>))}
          {steps.length < MAX_STEPS ? <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setSteps((a) => [...a, blank('send_template', templates)])} disabled={!usable.length}><MessageSquare className="size-3.5" />Message</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setSteps((a) => [...a, blank('wait', templates)])}><Clock className="size-3.5" />Wait</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setSteps((a) => [...a, blank('add_tag', templates)])}><Tag className="size-3.5" />Tag</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setSteps((a) => [...a, blank('only_if', templates)])}><Filter className="size-3.5" />Check</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setSteps((a) => [...a, blank('assign', templates, people)])} disabled={!people.length}><UserCheck className="size-3.5" />Assign</Button></div> : null}
          {!usable.length ? <p className="text-xs text-amber">You need an approved template first. Create one in Templates.</p> : null}
        </fieldset>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 size-5" checked={stopOnReply} onChange={(e) => setStopOnReply(e.target.checked)} /><span><strong>Stop when the customer replies</strong><br /><span className="text-muted">Recommended. Once they write back, a person should take over.</span></span></label>
        {problem ? <p className="text-sm text-amber" role="status">{problem}</p> : null}
        {error ? <FormError>{error}</FormError> : null}
        <div className="flex gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button className="flex-1" disabled={pending || !!problem || name.trim().length < 2} onClick={submit}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}Save journey</Button></div>
      </div>
    </Modal>
  );
}

function WaitEditor({ minutes, onChange }: { minutes: number; onChange: (m: number) => void }) {
  const unit = [...UNITS].reverse().find((u) => minutes % u.mult === 0) ?? UNITS[0];
  return (
    <div className="grid grid-cols-2 gap-2">
      <Input aria-label="How long" type="number" min={1} inputMode="numeric" value={minutes / unit.mult} onChange={(e) => onChange(Math.max(1, Math.round(Number(e.target.value) || 1)) * unit.mult)} />
      <Select aria-label="Unit" value={unit.mult} onChange={(e) => onChange((minutes / unit.mult) * Number(e.target.value))}>{UNITS.map((u) => <option key={u.label} value={u.mult}>{u.label}</option>)}</Select>
    </div>
  );
}

function Detail({ journey: j, groups, canEdit, onClose, flash, reload, names, who }: { journey: JourneyRow; groups: Group[]; canEdit: boolean; onClose: () => void; flash: (m: string) => void; reload: () => Promise<void>; names: Record<string, string>; who: Record<string, string> }) {
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [gid, setGid] = useState(groups[0]?.id ?? '');
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  useEffect(() => { let live = true; void listRuns(j.id).then((r) => { if (live) setRuns(r); }); return () => { live = false; }; }, [j.id]);
  const refresh = async () => { setRuns(await listRuns(j.id)); await reload(); };
  return (
    <Modal open onClose={onClose} title={j.name}>
      <div className="mt-2 flex flex-col gap-4">
        <ol className="flex flex-col gap-1 text-sm" aria-label="Steps">{j.steps.map((s, i) => <li key={i} className="rounded-lg bg-card2 px-3 py-2">{i + 1}. {describeStep(s, { templates: names, people: who })}</li>)}</ol>
        {canEdit && j.status === 'active' ? (
          <div className="rounded-xl border border-line p-3">
            <p className="mb-2 text-sm font-semibold">Add people</p>
            <p className="mb-2 text-xs text-muted">Everyone in the group joins at step 1. People who opted out are skipped, and nobody joins twice.</p>
            <div className="flex gap-2"><Select aria-label="Group" value={gid} onChange={(e) => setGid(e.target.value)} className="flex-1">{groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({num(g.count)})</option>)}</Select>
              <Button disabled={pending || !gid} onClick={() => start(async () => { setErr(''); const r = await enrollGroup(j.id, gid); if (!r.ok) { setErr(r.error); return; } flash(`Added ${num(r.data.enrolled)} ${r.data.enrolled === 1 ? 'person' : 'people'}${r.data.alreadyIn ? `, ${num(r.data.alreadyIn)} already in` : ''}${r.data.optedOut ? `, ${num(r.data.optedOut)} skipped (opted out)` : ''}${r.data.limited ? '. Daily limit reached; add the rest tomorrow.' : '.'}`); await refresh(); })}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}Add</Button></div>
            {err ? <p className="mt-2 text-sm text-rose" role="alert">{err}</p> : null}
          </div>) : null}
        {canEdit && j.counts.active > 0 ? <Button variant="outline" disabled={pending} onClick={() => { if (confirm(`Stop everyone in “${j.name}” now? Messages already sent stay sent.`)) start(async () => { const r = await stopAllRuns(j.id); flash(r.ok ? `Stopped ${r.data.stopped} ${r.data.stopped === 1 ? 'person' : 'people'}.` : r.error); await refresh(); }); }}>Stop everyone now</Button> : null}
        <div>
          <p className="mb-1 text-sm font-semibold">People ({runs ? runs.length : '…'}{runs && runs.length === 100 ? '+' : ''})</p>
          {runs && runs.length === 0 ? <p className="text-sm text-muted">Nobody yet.</p> : null}
          <ul className="flex max-h-72 flex-col divide-y divide-line overflow-y-auto rounded-xl border border-line text-sm">{(runs ?? []).map((r, i) => <li key={i} className="flex flex-col gap-0.5 px-3 py-2">
            <span className="flex justify-between gap-2"><strong>{r.name ?? 'No name'}</strong><span className={cn('rounded-full px-2 text-xs font-bold', r.status === 'completed' ? 'bg-brand/15 text-brand' : r.status === 'active' ? 'bg-indigo/15 text-indigo' : 'bg-ink/10')}>{{ active: 'In progress', completed: 'Finished', stopped: 'Stopped', failed: 'Problem' }[r.status] ?? r.status}</span></span>
            <span className="text-xs text-muted">{r.status === 'active' ? `Step ${Math.min(r.step + 1, j.steps.length)} of ${j.steps.length}${r.nextAt ? ` · next ${new Date(r.nextAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}` : ''}` : r.reason ?? ''}{r.error ? ` ${r.error}` : ''}</span></li>)}</ul>
        </div>
      </div>
    </Modal>
  );
}
