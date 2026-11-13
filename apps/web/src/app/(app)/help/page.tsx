import type { Metadata } from 'next';
import Link from 'next/link';
import { company } from '@/lib/company';
import { requireCtx } from '@/lib/session';

export const metadata: Metadata = { title: 'Help and support' };
export const dynamic = 'force-dynamic';

const FAQ: [string, string][] = [
  ['Why can I not message someone first?', 'WhatsApp only lets a business start a conversation with an approved template. Once the customer replies, you have 24 hours to reply freely. Create or pick one in Templates.'],
  ['Why was my template rejected?', 'The Templates page shows the reason in plain words. The usual causes are missing sample values, a link shortener, or a promotion filed as Updates. Fix it and submit a copy.'],
  ['Is a lead the same as consent?', 'No. A lead is someone who enquired. Marketing messages go only to people who agreed to receive them. See Opt-outs and consent.'],
  ['What happens when someone replies STOP?', 'They are blocked from every campaign straight away, whatever list they are on. They can still message you and you can still answer them.'],
  ['How do I get leads from my website or ads?', 'Open Leads, then Get leads. You can make a hosted form, a QR code, a website WhatsApp button, or import a CSV.'],
  ['Who can see the Activity log?', 'Owners and admins. It records who changed what and cannot be edited.'],
];

export default async function HelpPage() {
  await requireCtx();
  const c = company();
  const mail = c.supportEmail, wa = c.supportWhatsapp?.replace(/[^\d]/g, '') ?? null;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div><h2 className="font-display text-2xl font-extrabold">Help and support</h2><p className="text-sm text-muted">Answers first, then a person.</p></div>
      <div className="card divide-y divide-line">{FAQ.map(([q, a]) => <details key={q} className="group p-4"><summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 font-semibold">{q}<span className="text-brand transition-transform group-open:rotate-45" aria-hidden>+</span></summary><p className="mt-2 text-sm text-muted">{a}</p></details>)}</div>
      <div className="card p-4">
        <h3 className="mb-2 font-semibold">Contact us</h3>
        {mail || wa ? (
          <ul className="flex flex-col gap-2 text-sm">
            {mail ? <li>Email: <a className="font-semibold text-brand" href={`mailto:${mail}`}>{mail}</a></li> : null}
            {wa ? <li>WhatsApp: <a className="font-semibold text-brand" href={`https://wa.me/${wa}`}>{c.supportWhatsapp}</a></li> : null}
          </ul>
        ) : <p className="text-sm text-muted">Support contact details have not been set for this installation yet. The operator needs to set SUPPORT_EMAIL.</p>}
        <p className="mt-3 text-xs text-muted">Policies: <Link className="text-brand" href="/terms">Terms</Link> · <Link className="text-brand" href="/privacy">Privacy</Link> · <Link className="text-brand" href="/messaging-policy">Messaging policy</Link> · <Link className="text-brand" href="/refunds">Refunds</Link></p>
      </div>
    </div>
  );
}
