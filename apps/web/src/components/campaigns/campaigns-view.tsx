'use client';

import { useEffect, useState, useTransition } from 'react';
import { AlertTriangle, Calendar, CheckCircle2, FlaskConical, Loader2, Megaphone, Plus, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { WaBubble } from '@/components/ui/wa-bubble';
import { cancelCampaign, campaignReport, connectionState, createCampaign, listCampaigns, previewAudience, sendCampaign, type AudiencePreview, type CampaignReport, type CampaignRow } from '@/app/(app)/campaigns/actions';
import type { TemplateRow } from '@/app/(app)/templates/actions';
import type { GroupRow } from '@/app/(app)/contacts/actions';
import { cn } from '@/lib/utils';
import { inr } from '@/lib/cost';
import { variablesIn } from '@lbc/shared';

const STATUS: Record<string, [string, string]> = { draft: ['Draft', 'bg-ink/10'], scheduled: ['Scheduled', 'bg-indigo/15 text-indigo'], running: ['Sending', 'bg-amber/15 text-amber'], completed: ['Sent', 'bg-brand/15 text-brand'], paused: ['Paused', 'bg-amber/15 text-amber'], cancelled: ['Cancelled', 'bg-rose/15 text-rose'] };
const pct = (a = 0, b = 0) => (b ? Math.round((a / b) * 100) : 0);

export function CampaignsView({ initial, templates, groups, canEdit }: { initial: CampaignRow[]; templates: TemplateRow[]; groups: GroupRow[]; canEdit: boolean }) {
  const [rows, setRows] = useState(initial);
  const [wizard, setWizard] = useState(false);
  const [report, setReport] = useState<CampaignReport | null>(null);
  const [toast, setToast] = useState('');
  const [live, setLive] = useState(false);
  useEffect(() => { void connectionState().then((c) => setLive(c.live)); }, []);
  const [pending, start] = useTransition();
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4000); };
  const refresh = async (m?: string) => { setRows(await listCampaigns()); if (m) flash(m); };
  const approved = templates.filter((t) => t.status === 'approved');

  const totals = rows.filter((r) => r.status === 'completed').reduce((a, r) => ({ sent: a.sent + (r.counts.sent ?? 0), read: a.read + (r.counts.read ?? 0), replied: a.replied + (r.counts.replied ?? 0) }), { sent: 0, read: 0, replied: 0 });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h2 className="font-display text-2xl font-extrabold">Send to customers</h2><p className="text-sm text-muted">Send an approved message format to groups. You see the cost and who is skipped before you send.</p></div>
        {canEdit ? <Button onClick={() => setWizard(true)}><Plus className="size-4" />New bulk send</Button> : null}
      </div>

      {live ? null : <p className="flex items-start gap-2 rounded-xl border border-dashed border-amber/50 bg-amber/5 p-3 text-sm"><FlaskConical className="mt-0.5 size-4 shrink-0 text-amber" /><span><strong>Test mode.</strong> No WhatsApp number is connected yet, so sending is simulated and nothing reaches customers. Connect your number in Settings to send for real.</span></p>}

      {rows.some((r) => r.status === 'completed') ? (
        <div className="grid grid-cols-3 gap-3">
          {[['Sent', totals.sent], ['Read', `${pct(totals.read, totals.sent)}%`], ['Replied', `${pct(totals.replied, totals.sent)}%`]].map(([k, v]) => <div key={k as string} className="card p-4 text-center"><p className="font-display text-2xl font-extrabold tabular">{typeof v === 'number' ? v.toLocaleString('en-IN') : v}</p><p className="text-xs text-muted">{k as string}</p></div>)}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="card flex flex-col items-center p-10 text-center">
          <Megaphone className="mb-3 size-10 text-muted" /><p className="font-semibold">No campaigns yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted">{approved.length === 0 ? 'First create a message format and get it approved. Then you can send it to a group.' : 'Create your first campaign. It takes about a minute.'}</p>
          {canEdit && approved.length > 0 ? <Button className="mt-4" onClick={() => setWizard(true)}><Plus className="size-4" />New bulk send</Button> : null}
        </div>
      ) : (
        <div className="grid gap-3">
          {rows.map((c) => { const [sl, sc] = STATUS[c.status] ?? STATUS.draft!; return (
            <article key={c.id} className="card card-hover p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><h3 className="truncate font-display text-lg font-bold">{c.name}</h3>
                  <p className="text-xs text-muted">{c.templateName ?? 'Message format deleted'} · {c.groupNames.join(', ') || 'No group'}{c.scheduledAt ? ` · ${new Date(c.scheduledAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST` : ''}</p></div>
                <span className={cn('rounded-full px-2.5 py-1 text-xs font-bold', sc)}>{sl}</span>
              </div>
              {c.status === 'completed' ? (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {[['Sent', c.counts.sent], ['Delivered', c.counts.delivered], ['Read', c.counts.read], ['Replied', c.counts.replied], ['Failed', c.counts.failed]].map(([k, v]) => <div key={k as string} className="rounded-xl bg-card2 p-2.5 text-center"><p className="font-display text-lg font-bold tabular">{(Number(v) || 0).toLocaleString('en-IN')}</p><p className="text-[11px] text-muted">{k as string}{k !== 'Sent' && c.counts.sent ? ` · ${pct(Number(v), c.counts.sent)}%` : ''}</p></div>)}
                </div>
              ) : <p className="mt-2 text-sm text-muted">{(c.counts.audience ?? 0).toLocaleString('en-IN')} people · estimated {inr(c.estCostPaise)} incl. GST</p>}
              <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                {c.status === 'completed' ? <Button size="sm" variant="outline" onClick={() => start(async () => setReport(await campaignReport(c.id)))}>Report</Button> : null}
                {canEdit && ['draft', 'scheduled', 'paused'].includes(c.status) ? <>
                  <Button size="sm" disabled={pending} onClick={() => { if (confirm(live ? `Send “${c.name}” now to real customers?` : `Send “${c.name}” now (test mode)?`)) start(async () => { const r = await sendCampaign(c.id); if (!r.ok) flash(r.error); else await refresh(r.data.testMode ? `Test send done: ${r.data.sent} people.` : `Queued for ${r.data.sent} people. Sending starts within a minute.`); }); }}><Send className="size-4" />Send now</Button>
                  <Button size="sm" variant="ghost" onClick={() => { if (confirm('Cancel this campaign?')) start(async () => { const r = await cancelCampaign(c.id); if (!r.ok) flash(r.error); else await refresh('Cancelled.'); }); }}>Cancel</Button></> : null}
              </div>
            </article>); })}
        </div>
      )}

      {wizard ? <Wizard live={live} templates={approved} groups={groups} onClose={() => setWizard(false)} onDone={(m) => { setWizard(false); void refresh(m); }} /> : null}
      <Modal open={!!report} onClose={() => setReport(null)} title={report ? report.c.name : 'Report'} wide>
        {report ? (
          <div className="flex flex-col gap-4">
            <p className="flex items-center gap-2 rounded-xl bg-amber/10 p-3 text-sm text-amber"><FlaskConical className="size-4" />These are simulated test results.</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{[['Sent', report.c.counts.sent], ['Delivered', report.c.counts.delivered], ['Read', report.c.counts.read], ['Replied', report.c.counts.replied], ['Skipped', report.c.counts.skipped]].map(([k, v]) => <div key={k as string} className="rounded-xl border border-line p-3 text-center"><p className="font-display text-2xl font-extrabold tabular">{(Number(v) || 0).toLocaleString('en-IN')}</p><p className="text-xs text-muted">{k as string}</p></div>)}</div>
            <p className="text-sm text-muted">Estimated cost <strong className="text-ink">{inr(report.c.estCostPaise)}</strong> incl. GST. {report.c.counts.optedOut ? `${report.c.counts.optedOut} people who opted out were skipped.` : ''}</p>
            {[['Skipped', report.skipped], ['Failed', report.failed]].map(([t, list]) => (list as CampaignReport['failed']).length ? (
              <div key={t as string}><h4 className="mb-1 text-sm font-bold">{t as string}</h4><ul className="max-h-40 divide-y divide-line overflow-y-auto rounded-xl border border-line text-sm">{(list as CampaignReport['failed']).map((r, i) => <li key={i} className="flex justify-between gap-3 px-3 py-2"><span className="truncate">{r.name ?? r.phone}</span><span className="shrink-0 text-muted">{r.reason}</span></li>)}</ul></div>) : null)}
          </div>) : null}
      </Modal>
      {toast ? <div role="status" className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-bg shadow-xl md:bottom-8">{toast}</div> : null}
    </div>
  );
}

function Wizard({ live, templates, groups, onClose, onDone }: { live: boolean; templates: TemplateRow[]; groups: GroupRow[]; onClose: () => void; onDone: (m: string) => void }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [tid, setTid] = useState(templates[0]?.id ?? '');
  const [gids, setGids] = useState<string[]>([]);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const [repeat, setRepeat] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
  const [cap, setCap] = useState('');
  const [vars, setVars] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [aud, setAud] = useState<AudiencePreview | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const tpl = templates.find((t) => t.id === tid);

  useEffect(() => {
    if (!gids.length || !tpl) { setAud(null); return; }
    let live = true;
    void previewAudience(gids, tpl.category).then((a) => { if (live) setAud(a); });
    return () => { live = false; };
  }, [gids, tpl]);

  const varCount = tpl ? new Set(variablesIn(tpl.body)).size : 0;
  useEffect(() => { setVars((old) => Array.from({ length: varCount }, (_, i) => old[i] ?? (i === 0 ? '@name' : ''))); }, [varCount, tid]);
  const needsCode = !!tpl?.buttons.some((b) => b.type === 'copy_code');
  const needsEnd = !!tpl?.offer?.hasExpiration;
  const offerOk = (!needsCode || /^[A-Za-z0-9_-]{1,15}$/.test(code.trim())) && (!needsEnd || !!endsAt);
  const varsOk = vars.length === varCount && vars.every((x) => x.trim().length > 0);
  const capNum = cap ? Number(cap) : undefined;
  const overCap = !!(aud && capNum && aud.cost.totalPaise > capNum * 100);

  function submit() {
    setError('');
    start(async () => {
      const r = await createCampaign({ name, templateId: tid, groupIds: gids, when, scheduledAt: at ? new Date(at).toISOString() : undefined, repeat: needsEnd ? 'none' : repeat, spendCapRupees: capNum, varMap: vars, offerCode: needsCode ? code.trim() : undefined, offerEndsAt: needsEnd && endsAt ? new Date(endsAt).toISOString() : undefined });
      if (!r.ok) { setError(r.error); return; }
      if (when === 'now') { const s = await sendCampaign(r.data.id); if (!s.ok) { setError(s.error); return; } onDone(s.data.testMode ? `Test send done: ${s.data.sent} people.` : `Queued for ${s.data.sent} people. Sending starts within a minute.`); } else onDone('Campaign scheduled.');
    });
  }

  const steps = ['Template', 'Audience', 'Schedule', 'Review'];
  return (
    <Modal open onClose={onClose} title="New bulk send" wide>
      <ol className="mb-5 grid grid-cols-4 gap-1.5 text-center text-[11px] font-semibold">{steps.map((s, i) => <li key={s} className={cn('rounded-full px-1 py-1.5', i + 1 === step ? 'grad-bg text-white' : i + 1 < step ? 'bg-brand/15 text-brand' : 'bg-ink/5 text-muted')}>{i + 1}. {s}</li>)}</ol>
      <FormError>{error}</FormError>

      {step === 1 ? (
        <div className="mt-3 grid gap-5 md:grid-cols-[1fr_20rem]">
          <div className="flex flex-col gap-4">
            <Field label="Name this bulk send"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="November renewal reminder" maxLength={120} autoFocus /></Field>
            <Field label="Message format"><Select value={tid} onChange={(e) => setTid(e.target.value)}>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
            {varCount > 0 ? (
              <div className="flex flex-col gap-3 rounded-xl border border-line p-3">
                <p className="text-sm font-semibold">Fill in the blanks</p>
                {vars.map((val, i) => {
                  const preset = ['@name', '@fullname', '@phone'].includes(val);
                  return (
                    <div key={i} className="grid gap-1.5">
                      <label className="text-xs font-semibold text-muted">{`{{${i + 1}}}`}</label>
                      <Select value={preset ? val : 'fixed'} onChange={(e) => setVars((o) => o.map((x, j) => (j === i ? (e.target.value === 'fixed' ? '' : e.target.value) : x)))}>
                        <option value="@name">Customer’s first name</option>
                        <option value="@fullname">Customer’s full name</option>
                        <option value="@phone">Customer’s phone number</option>
                        <option value="fixed">Same text for everyone</option>
                      </Select>
                      {!preset ? <Input value={val} onChange={(e) => setVars((o) => o.map((x, j) => (j === i ? e.target.value : x)))} placeholder="e.g. 20% off until Sunday" maxLength={200} /> : null}
                    </div>
                  );
                })}
                <p className="text-xs text-muted">If a customer has no name saved, we say “there”.</p>
              </div>
            ) : null}
            {needsCode || needsEnd ? (
              <div className="flex flex-col gap-3 rounded-xl border border-amber/40 bg-amber/5 p-3">
                <p className="text-sm font-semibold">This is an offer</p>
                {needsCode ? <Field label="Offer code" hint="Every customer gets this code on the Copy code button. 1 to 15 letters or numbers."><Input value={code} maxLength={15} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9_-]/g, '').toUpperCase())} placeholder="WEEKEND20" /></Field> : null}
                {needsEnd ? <Field label="Offer ends (IST)" hint="WhatsApp shows a live countdown to this time. It must be at least an hour after you send."><Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></Field> : null}
              </div>
            ) : null}
            <Button disabled={name.trim().length < 2 || !tid || !varsOk || !offerOk} onClick={() => setStep(2)}>Next: who gets it</Button>
          </div>
          {tpl ? <WaBubble offer={tpl.offer} media={tpl.headerMedia ? { kind: tpl.headerMedia, src: tpl.assetId ? `/api/template-assets/${tpl.assetId}` : null, name: tpl.assetName } : null} header={tpl.headerText} body={tpl.body} footer={tpl.footer} buttons={tpl.buttons} values={tpl.samples} /> : null}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="mt-3 flex flex-col gap-4">
          {groups.length === 0 ? <p className="rounded-xl bg-amber/10 p-4 text-sm">You have no groups yet. Create a group in Contacts first.</p> : (
            <fieldset><legend className="mb-2 text-sm font-semibold">Send to these groups</legend>
              <div className="grid gap-2 sm:grid-cols-2">{groups.map((g) => (
                <label key={g.id} className={cn('flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border px-4', gids.includes(g.id) ? 'border-brand bg-brand/10' : 'border-line')}>
                  <span className="flex items-center gap-3"><input type="checkbox" className="size-5 accent-[var(--brand)]" checked={gids.includes(g.id)} onChange={() => setGids(gids.includes(g.id) ? gids.filter((x) => x !== g.id) : [...gids, g.id])} /><span className="font-medium">{g.name}</span></span><span className="text-xs text-muted tabular">{g.count}</span>
                </label>))}</div></fieldset>)}
          {aud ? (
            <div className="rounded-2xl border border-line p-4 text-sm">
              <p className="flex items-center gap-2 font-bold"><CheckCircle2 className="size-4 text-brand" />{aud.sendable.toLocaleString('en-IN')} people will receive this</p>
              {aud.optedOut + aud.noRecord > 0 ? <p className="mt-2 flex gap-2 text-amber"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{aud.optedOut} opted out and {aud.noRecord} with no permission record will be skipped automatically.</p> : null}
            </div>) : null}
          <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(1)}>Back</Button><Button className="flex-1" disabled={!aud || aud.sendable === 0} onClick={() => setStep(3)}>Next: schedule</Button></div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="mt-3 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="When to send">
            {([['now', 'Send now', Send], ['later', 'Schedule', Calendar]] as const).map(([v, l, I]) => <button key={v} role="radio" aria-checked={when === v} onClick={() => setWhen(v)} className={cn('flex min-h-14 items-center justify-center gap-2 rounded-xl border font-semibold', when === v ? 'border-brand bg-brand/10 text-brand' : 'border-line')}><I className="size-4" />{l}</button>)}
          </div>
          {when === 'later' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date and time (IST)"><Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
              <Field label="Repeat" hint={needsEnd ? "An offer with a countdown is sent once." : undefined}><Select disabled={needsEnd} value={needsEnd ? "none" : repeat} onChange={(e) => setRepeat(e.target.value as 'none')}><option value="none">Does not repeat</option><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option></Select></Field>
            </div>) : null}
          <Field label="Spend cap in ₹ (optional)" hint="We refuse to send if the estimate goes above this."><Input inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d.]/g, ''))} placeholder="2000" /></Field>
          <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(2)}>Back</Button><Button className="flex-1" disabled={when === 'later' && !at} onClick={() => setStep(4)}>Next: review</Button></div>
        </div>
      ) : null}

      {step === 4 && aud && tpl ? (
        <div className="mt-3 flex flex-col gap-4">
          <dl className="divide-y divide-line rounded-2xl border border-line text-sm">
            {[['Campaign', name], ['Message format', tpl.name], ['People', aud.sendable.toLocaleString('en-IN')], ['When', when === 'now' ? 'Right now' : `${new Date(at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} IST${repeat !== 'none' ? `, repeats ${repeat}` : ''}`]].map(([k, v]) => <div key={k} className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-muted">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>)}
            <div className="px-4 py-3"><div className="flex justify-between"><dt className="text-muted">{aud.cost.messages.toLocaleString('en-IN')} × ₹{aud.cost.ratePerMessage.toFixed(4)}</dt><dd className="tabular">{aud.cost.baseLabel}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">GST 18%</dt><dd className="tabular">{aud.cost.gstLabel}</dd></div>
              <div className="mt-1 flex justify-between text-base font-bold"><dt>Estimated total</dt><dd className="grad-text font-display text-xl tabular">{aud.cost.totalLabel}</dd></div></div>
          </dl>
          <p className="text-xs text-muted">Meta charges this to your card. Some messages may be blocked by Meta’s per-person limit, and blocked ones are not charged.</p>
          {overCap ? <FormError>The estimate is above your spend cap of ₹{capNum}.</FormError> : null}
          <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(3)}>Back</Button><Button className="flex-1" disabled={pending || overCap} onClick={submit}>{pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}{when === 'now' ? (live ? 'Send now' : 'Send now (test)') : 'Schedule campaign'}</Button></div>
        </div>
      ) : null}
    </Modal>
  );
}
