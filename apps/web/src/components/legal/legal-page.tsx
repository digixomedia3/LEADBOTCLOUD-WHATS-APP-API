import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { company } from '@/lib/company';

export const LEGAL_LINKS: [string, string][] = [
  ['/terms', 'Terms of Service'], ['/privacy', 'Privacy Policy'], ['/acceptable-use', 'Acceptable Use'], ['/messaging-policy', 'Messaging and opt-in'],
  ['/refunds', 'Refunds and cancellation'], ['/data-deletion', 'Data deletion'],
];

export interface Section { id: string; title: string; body: React.ReactNode }

/** One calm, readable layout for every legal page. Works on a 360 px phone. */
export function LegalPage({ title, intro, sections, current }: { title: string; intro: React.ReactNode; sections: Section[]; current: string }) {
  const c = company();
  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="flex min-h-11 items-center gap-2.5"><span className="grad-bg flex size-9 items-center justify-center rounded-xl font-black text-white">L</span><span className="font-display font-extrabold">LeadBotCloud</span></Link>
          <Link href="/login" className="flex min-h-11 items-center text-sm font-semibold text-brand">Log in</Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-8 px-4 py-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="Legal pages" className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible">
            {LEGAL_LINKS.map(([h, l]) => (
              <li key={h} className="shrink-0"><Link href={h} aria-current={h === current ? 'page' : undefined} className={`flex min-h-11 items-center whitespace-nowrap rounded-xl px-3 text-sm ${h === current ? 'bg-brand/10 font-bold text-brand' : 'text-muted hover:text-ink'}`}>{l}</Link></li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0">
          {c.missing.length ? (
            <div role="alert" className="mb-6 flex gap-3 rounded-2xl border border-amber/50 bg-amber/10 p-4 text-sm"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber" /><div><p className="font-semibold">Company details are incomplete</p><p className="mt-1 text-muted">Set {c.missing.map((m, i) => <span key={m}>{i ? ', ' : ''}<code className="font-mono text-xs">{m}</code></span>)} before publishing these pages. Meta and Razorpay check them against your business verification.</p></div></div>
          ) : null}
          <h1 className="font-display text-3xl font-extrabold md:text-4xl">{title}</h1>
          <p className="mt-2 text-sm text-muted">Version {c.termsVersion} · Last updated {c.updated}</p>
          <div className="mt-5 text-[15px] leading-relaxed text-ink/90">{intro}</div>

          <ol className="mt-6 rounded-2xl border border-line bg-card p-4 text-sm">
            <li className="mb-1 font-semibold">On this page</li>
            {sections.map((s) => <li key={s.id}><a href={`#${s.id}`} className="flex min-h-9 items-center text-brand">{s.title}</a></li>)}
          </ol>

          <div className="mt-8 flex flex-col gap-8">
            {sections.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-6">
                <h2 className="font-display text-xl font-bold">{s.title}</h2>
                <div className="mt-2 flex flex-col gap-3 text-[15px] leading-relaxed text-ink/90 [&_a]:font-semibold [&_a]:text-brand [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">{s.body}</div>
              </section>
            ))}
          </div>

          <aside className="mt-10 rounded-2xl border border-line bg-card p-4 text-sm">
            <p className="font-semibold">{c.brand}, a product of {c.legalName}</p>
            {c.address ? <p className="mt-1 text-muted">{c.address}</p> : null}
            {c.gstin ? <p className="text-muted">GSTIN: {c.gstin}</p> : null}
            <p className="mt-1 text-muted">{c.supportEmail ? <>Email: <a className="font-semibold text-brand" href={`mailto:${c.supportEmail}`}>{c.supportEmail}</a></> : null}{c.supportEmail && c.supportWhatsapp ? ' · ' : ''}{c.supportWhatsapp ? <>WhatsApp: <a className="font-semibold text-brand" href={`https://wa.me/${c.supportWhatsapp.replace(/\D/g, '')}`}>{c.supportWhatsapp}</a></> : null}</p>
          </aside>
        </main>
      </div>
    </div>
  );
}

/** The operator's name, used inside the text so it always matches the verification. */
export const Who = () => <>{company().legalName}</>;
