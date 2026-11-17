import { inr } from '@lbc/shared';
import { loadOverview } from './actions';

const n = (x: number) => (x ?? 0).toLocaleString('en-IN');
function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: 'bad' | 'warn'; hint?: string }) {
  return <div className="card p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p><p className={`mt-1 font-display text-2xl font-extrabold tabular-nums ${tone === 'bad' ? 'text-rose' : tone === 'warn' ? 'text-amber' : ''}`}>{value}</p>{hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}</div>;
}

export default async function AdminHome() {
  const r = await loadOverview();
  if (!r.ok) return <p role="alert" className="rounded-xl bg-rose/10 p-4 text-rose">{r.error}</p>;
  const o = r.data; const t = o.tenants; const live = (t.ready ?? 0) + (t.onboarding ?? 0);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold">Overview</h1>
      <section aria-label="Workspaces" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Workspaces" value={n(Object.values(t).reduce((a, b) => a + b, 0))} hint={`${n(live)} in use · ${n(t.pending_meta ?? 0)} not connected`} />
        <Stat label="New this week" value={n(o.newTenants7d)} />
        <Stat label="People with logins" value={n(o.users)} />
        <Stat label="Suspended" value={n(t.suspended ?? 0)} tone={(t.suspended ?? 0) ? 'warn' : undefined} />
      </section>
      <section aria-label="WhatsApp" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Connected numbers" value={n(o.connected)} />
        <Stat label="Connection problems" value={n(o.tokenProblems)} tone={o.tokenProblems ? 'bad' : undefined} hint="Token expired or removed" />
        <Stat label="Restricted by Meta" value={n(o.restricted)} tone={o.restricted ? 'bad' : undefined} />
        <Stat label="Waiting for review" value={n(o.flagged)} tone={o.flagged ? 'warn' : undefined} hint="Risky business types" />
      </section>
      <section aria-label="Sending" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Messages in 24 hours" value={n(o.messages24h)} />
        <Stat label="Failed in 24 hours" value={n(o.failed24h)} tone={o.messages24h > 20 && o.failed24h / o.messages24h > 0.2 ? 'bad' : undefined} />
        <Stat label="Waiting to send" value={n(o.queued)} tone={o.queued > 500 ? 'warn' : undefined} hint="Includes held for quiet hours" />
        <Stat label="Campaigns and journeys running" value={`${n(o.campaignsRunning)} · ${n(o.journeysRunning)}`} />
      </section>
      <section aria-label="System" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Webhooks not processed" value={n(o.webhookBacklog)} tone={o.webhookBacklog > 50 ? 'bad' : undefined} hint="Should stay near zero" />
        <Stat label="Webhook errors, 24 hours" value={n(o.webhookErrors24h)} tone={o.webhookErrors24h ? 'warn' : undefined} />
        <Stat label="Active subscriptions" value={n(o.subs.active ?? 0)} hint={`${n(o.subs.halted ?? 0)} halted · ${n(o.subs.cancelled ?? 0)} cancelled`} />
        <Stat label="Monthly recurring (incl. GST)" value={inr(o.mrrPaise)} hint="From active subscriptions" />
      </section>
      <section aria-label="Plans" className="card p-4"><h2 className="mb-2 font-display text-lg font-bold">Workspaces by plan</h2>
        <ul className="flex flex-wrap gap-2 text-sm">{Object.entries(o.plans).map(([p, c]) => <li key={p} className="rounded-full bg-card2 px-3 py-1"><strong className="capitalize">{p}</strong> {n(c)}</li>)}</ul></section>
    </div>
  );
}
