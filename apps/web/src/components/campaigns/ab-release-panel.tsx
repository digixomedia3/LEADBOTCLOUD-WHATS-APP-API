'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { releaseWinner } from '@/app/(app)/campaigns/actions';
import { RELEASE_REASONS } from '@lbc/shared/release-reasons';
import type { CampaignReportData } from '@/lib/core/campaign-report';

const num = (n: number) => n.toLocaleString('en-IN');

/** After a test that kept people back: shows what is waiting and lets an owner or admin choose which version goes to them. Asks once, in plain words, before anything is sent. */
export function AbReleasePanel({ campaignId, ab, canAct }: { campaignId: string; ab: NonNullable<CampaignReportData['abTest']>; canAct: boolean }) {
  const h = ab.hold!; const router = useRouter();
  const [pick, setPick] = useState<'a' | 'b' | null>(null); const [err, setErr] = useState(''); const [busy, start] = useTransition();
  const name = (v: 'a' | 'b') => `Version ${v.toUpperCase()} (${(v === 'a' ? ab.a.template : ab.b.template) ?? 'deleted template'})`;

  if (h.releasedVersion) return (
    <section className="card p-5" aria-label="Winner sent"><h3 className="flex items-center gap-2 font-display text-lg font-bold"><Rocket className="size-5 text-brand" aria-hidden />Winner sent</h3>
      <p className="mt-1 text-sm" role="status">{name(h.releasedVersion)} was sent to the people who were kept back. Their results are in the numbers above, but they are not part of the test comparison.</p></section>);
  if (h.releaseWaiting) return (
    <section className="card p-5" aria-label="Winner on its way"><h3 className="flex items-center gap-2 font-display text-lg font-bold"><Loader2 className="size-5 animate-spin text-brand" aria-hidden />Sending the winner</h3>
      <p className="mt-1 text-sm" role="status">The winner is being sent to {num(h.held)} people. Anyone who has since opted out is left out. This page updates as messages go out.</p></section>);

  const suggestion = h.suggested ? `${name(h.suggested)} is doing better, with enough messages to be fairly sure it is not chance.` : 'There is no clear winner yet. You can still choose, or wait for more people to read the messages.';
  return (
    <section className="card p-5" aria-label="Send the winner">
      <h3 className="flex items-center gap-2 font-display text-lg font-bold"><Rocket className="size-5 text-brand" aria-hidden />Send the winner to everyone else</h3>
      <p className="mt-1 text-sm">{num(h.held)} people were kept back while {h.testPct}% of your audience tested the two versions.</p>
      {!h.testDone ? <p className="mt-2 text-sm text-muted" role="status">The test messages are still going out. You can choose once they have all been sent.</p> : <p className="mt-2 text-sm font-semibold" role="status">{suggestion}</p>}
      {h.error ? <p className="mt-2 rounded-lg bg-rose/10 p-2.5 text-sm text-rose" role="alert">The last try could not go ahead. {RELEASE_REASONS[h.error] ?? 'Something stopped it.'}</p> : null}
      {!canAct ? <p className="mt-2 text-xs text-muted">Only an owner or admin can send the winner.</p> : h.testDone ? (
        <div className="mt-3 flex flex-col gap-2">
          {pick === null ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {(['a', 'b'] as const).map((v) => <Button key={v} variant={h.suggested === v ? 'primary' : 'outline'} onClick={() => { setErr(''); setPick(v); }}>Send {name(v)}</Button>)}
            </div>
          ) : (
            <div className="rounded-xl border border-line p-3">
              <p className="text-sm font-semibold">Send {name(pick)} to {num(h.held)} people?</p>
              <p className="mt-1 text-xs text-muted">This cannot be undone once the messages start. Anyone who has opted out since the test is left out, and the cost shows in your campaign report.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => start(async () => { const r = await releaseWinner(campaignId, pick); if (!r.ok) { setErr(r.error); setPick(null); return; } router.refresh(); })}>{busy ? 'Sending…' : 'Yes, send it'}</Button>
                <Button variant="outline" disabled={busy} onClick={() => setPick(null)}>Not yet</Button>
              </div>
            </div>)}
          {err ? <p className="text-sm text-rose" role="alert">{err}</p> : null}
        </div>) : null}
    </section>
  );
}
