import type { Metadata } from 'next';
import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { CheckCircle2, Circle } from 'lucide-react';
import { db, requireCtx } from '@/lib/session';

export const metadata: Metadata = { title: 'Get started' };
export const dynamic = 'force-dynamic';

export default async function GetStartedPage() {
  const ctx = await requireCtx();
  const n = await db(ctx, async (tx) => ((await tx.execute(sql`select
      (select count(*) from meta_accounts a join phone_numbers p on p.meta_account_id = a.id where a.token_status = 'valid' and a.health_state = 'ok')::int as wa,
      (select count(*) from templates where status = 'approved')::int as tpl,
      (select count(*) from contacts)::int as contacts,
      (select count(*) from campaigns where status in ('scheduled','running','completed'))::int as camps,
      (select count(*) from tenant_members)::int + (select count(*) from invitations)::int as team,
      (select count(*) from lead_forms)::int + (select count(*) from lead_sources where kind <> 'ctwa')::int as capture,
      (select count(*) from automation_rules where active)::int as auto`)) as unknown as Record<string, number>[])[0]!) as Record<string, number>;
  const steps = [
    { done: (n.wa ?? 0) > 0, title: 'Connect your WhatsApp number', body: 'Link the number your customers already know.', href: '/settings', cta: 'Open settings' },
    { done: (n.tpl ?? 0) > 0, title: 'Get a template approved', body: 'WhatsApp must approve a template before you can message people first.', href: '/templates', cta: 'Open templates' },
    { done: (n.contacts ?? 0) > 0, title: 'Add your customers', body: 'Paste numbers or upload a CSV. Only people who agreed to hear from you.', href: '/contacts', cta: 'Open contacts' },
    { done: (n.capture ?? 0) > 0, title: 'Start capturing leads', body: 'A hosted form, QR code or website button brings enquiries in on their own.', href: '/leads', cta: 'Open leads' },
    { done: (n.auto ?? 0) > 0, title: 'Turn on an automatic reply', body: 'A welcome or away message so nobody waits.', href: '/automation', cta: 'Open automation' },
    { done: (n.team ?? 0) > 1, title: 'Invite a teammate', body: 'Let someone else answer chats and follow up leads.', href: '/settings', cta: 'Invite' },
    { done: (n.camps ?? 0) > 0, title: 'Send your first campaign', body: 'See the cost and your daily limit before you confirm.', href: '/campaigns', cta: 'Open campaigns' },
  ];
  const done = steps.filter((s) => s.done).length;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div>
        <h2 className="font-display text-2xl font-extrabold">Get started</h2>
        <p className="text-sm text-muted">{done} of {steps.length} done. This list ticks itself off from what is really in your workspace.</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={steps.length}><div className="grad-bg h-full rounded-full transition-all" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      </div>
      <ol className="card divide-y divide-line">
        {steps.map((s) => (
          <li key={s.title} className="flex items-start gap-3 p-4">
            {s.done ? <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-brand" aria-label="Done" /> : <Circle className="mt-0.5 size-6 shrink-0 text-muted" aria-label="Not done" />}
            <div className="min-w-0 flex-1"><p className={s.done ? 'font-semibold text-muted line-through' : 'font-semibold'}>{s.title}</p><p className="text-sm text-muted">{s.body}</p></div>
            {!s.done ? <Link href={s.href} className="shrink-0 self-center rounded-xl bg-brand/10 px-3 py-2 text-sm font-semibold text-brand hover:bg-brand/20">{s.cta}</Link> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
