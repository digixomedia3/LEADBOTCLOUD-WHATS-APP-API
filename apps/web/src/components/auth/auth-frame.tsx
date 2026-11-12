import Link from 'next/link';

/** Shared frame for login, signup and onboarding: aurora panel on the left (desktop), form on the right. */
export function AuthFrame({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="aurora hidden flex-col justify-between p-10 lg:flex">
        <span className="blob" /><span className="aurora-grid" />
        <Link href="/" className="flex items-center gap-2.5"><span className="grad-bg flex size-10 items-center justify-center rounded-xl text-lg font-black text-white">L</span><span className="font-display text-xl font-extrabold">LeadBot<span className="grad-text">Cloud</span></span></Link>
        <div className="max-w-md">
          <h2 className="font-display text-4xl font-extrabold leading-tight">WhatsApp marketing that <span className="grad-text">protects your number</span> and shows every rupee first.</h2>
          <ul className="mt-6 space-y-3 text-white/80">
            <li>Campaigns with cost, limit and opt-out checks before you send</li>
            <li>Contacts, groups and CSV import with consent tracking</li>
            <li>Shared inbox, official templates and renewal reminders</li>
          </ul>
        </div>
        <p className="text-xs text-white/50">LeadBotCloud, a product of DigiXoMedia</p>
      </aside>
      <main className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-8 flex items-center gap-2.5 lg:hidden"><span className="grad-bg flex size-9 items-center justify-center rounded-xl font-black text-white">L</span><span className="font-display text-lg font-extrabold">LeadBotCloud</span></Link>
          <h1 className="font-display text-3xl font-extrabold">{title}</h1>
          <p className="mt-1.5 text-muted">{subtitle}</p>
          <div className="mt-7">{children}</div>
          {footer ? <div className="mt-6 text-center text-sm text-muted">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}
