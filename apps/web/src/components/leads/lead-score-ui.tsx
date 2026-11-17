'use client';

import { useEffect, useState, useTransition } from 'react';
import { Loader2, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { DEFAULT_WEIGHTS, HOT_FROM, WARM_FROM, WEIGHT_KEYS, WEIGHT_LABEL, scoreHeadline, weightMax, type Band, type ScoreReason, type Weights } from '@lbc/shared/lead-score';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';
import { loadScoringRules, resetScoringRulesAction, saveScoringRulesAction } from '@/app/(app)/leads/actions';

export const BAND_LABEL: Record<Band, string> = { hot: 'Hot', warm: 'Warm', cold: 'Cold', won: 'Won', closed: 'Closed' };
const BAND_STYLE: Record<Band, string> = {
  hot: 'bg-rose-100 text-rose-800', warm: 'bg-amber-100 text-amber-800', cold: 'bg-sky-100 text-sky-800', won: 'bg-emerald-100 text-emerald-800', closed: 'bg-slate-200 text-slate-600',
};

/** A small coloured pill. Says the word as well as the number, so it never relies on colour alone. */
export function ScoreBadge({ score, band, className }: { score: number; band: Band; className?: string }) {
  return <span className={cn('inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums', BAND_STYLE[band], className)} title={`Score ${score} out of 100`}>{BAND_LABEL[band]}{band === 'closed' || band === 'won' ? '' : ` ${score}`}</span>;
}

/** Why the score is what it is, point by point. */
export function ScoreBreakdown({ score, band, reasons }: { score: number; band: Band; reasons: ScoreReason[] }) {
  return (
    <section className="rounded-xl border border-line p-3" aria-label="Lead score">
      <div className="flex flex-wrap items-center gap-2"><ScoreBadge score={score} band={band} /><span className="text-sm font-semibold">{scoreHeadline({ score, band, reasons })}</span></div>
      {band === 'closed' || band === 'won' ? null : (
        <ul className="mt-2 flex flex-col divide-y divide-line text-sm">
          {reasons.map((r, i) => <li key={i} className="flex justify-between gap-3 py-1"><span>{r.label}</span><span className={cn('tabular-nums font-semibold', r.points < 0 ? 'text-rose-700' : 'text-emerald-700')}>{r.points > 0 ? '+' : ''}{r.points}</span></li>)}
          <li className="flex justify-between gap-3 py-1 font-bold"><span>Score</span><span className="tabular-nums">{score}</span></li>
        </ul>)}
      <p className="mt-2 text-xs text-muted">A score only sorts and labels leads for you. It never sends anything. Hot is {HOT_FROM} and up, warm is {WARM_FROM} to {HOT_FROM - 1}.</p>
    </section>
  );
}

/** Edit how many points each signal is worth. Owners and admins only (the server checks too). */
export function ScoringRules({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [w, setW] = useState<Weights | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const [err, setErr] = useState(''); const [ok, setOk] = useState(false); const [pending, start] = useTransition();
  const fill = (x: Weights) => { setW(x); setText(Object.fromEntries(WEIGHT_KEYS.map((k) => [k, String(x[k])]))); };
  useEffect(() => { void loadScoringRules().then(fill); }, []);
  const parsed = (): Weights | null => { const o = {} as Weights; for (const k of WEIGHT_KEYS) { const t = (text[k] ?? '').trim(); if (!/^\d+$/.test(t)) return null; o[k] = Number(t); } return o; };
  const save = () => start(async () => {
    setErr(''); setOk(false); const p = parsed(); if (!p) { setErr('Every rule needs a whole number.'); return; }
    const r = await saveScoringRulesAction(p); if (!r.ok) { setErr(r.error); return; } fill(r.data); setOk(true); onSaved();
  });
  const reset = () => start(async () => { setErr(''); setOk(false); const r = await resetScoringRulesAction(); if (!r.ok) { setErr(r.error); return; } fill(r.data); setOk(true); onSaved(); });
  const dirty = !!w && WEIGHT_KEYS.some((k) => text[k] !== String(w[k]));
  const custom = !!w && WEIGHT_KEYS.some((k) => w[k] !== DEFAULT_WEIGHTS[k]);
  return (
    <Modal open onClose={onClose} title="How leads are scored">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">Every lead starts at 10 points and gains or loses points for what they actually do. Change how much each one is worth. Won leads are always 100 and lost or junk leads are always 0.</p>
        {!w ? <p className="text-sm text-muted"><Loader2 className="mr-1 inline size-4 animate-spin" />Loading…</p> : (
          <ul className="flex flex-col divide-y divide-line">
            {WEIGHT_KEYS.map((k) => (
              <li key={k} className="grid grid-cols-[1fr_5rem] items-center gap-3 py-2">
                <div className="min-w-0"><label htmlFor={`w-${k}`} className="text-sm font-semibold">{WEIGHT_LABEL[k].label}</label><p className="text-xs text-muted">{WEIGHT_LABEL[k].hint}</p></div>
                <input id={`w-${k}`} inputMode="numeric" aria-label={`${WEIGHT_LABEL[k].label} points`} className="h-11 w-full rounded-lg border border-line bg-card px-2 text-center tabular-nums" value={text[k] ?? ''} maxLength={2}
                  onChange={(e) => setText((o) => ({ ...o, [k]: e.target.value.replace(/\D/g, '') }))} />
                <p className="col-span-2 -mt-1 text-right text-[11px] text-muted">0 to {weightMax(k)} · standard {DEFAULT_WEIGHTS[k]}</p>
              </li>))}
          </ul>)}
        {err ? <p role="alert" className="text-sm text-rose-700">{err}</p> : null}
        {ok ? <p role="status" className="text-sm text-emerald-700">Saved. Scores update straight away.</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending || !w || !dirty} onClick={save}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}Save rules</Button>
          <Button variant="outline" disabled={pending || !w || !custom} onClick={reset}><RotateCcw className="size-4" />Back to standard</Button>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

export function ScoringButton({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  return (<><Button variant="outline" size="sm" onClick={() => setOpen(true)}><SlidersHorizontal className="size-4" />Scoring rules</Button>{open ? <ScoringRules onClose={() => setOpen(false)} onSaved={onSaved} /> : null}</>);
}
