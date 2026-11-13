'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import { LIBRARY_GROUPS, TEMPLATE_LIBRARY, uniqueTemplateName, type LibraryGroup } from '@lbc/shared';
import { Button } from '@/components/ui/button';
import { WaBubble } from '@/components/ui/wa-bubble';
import { saveTemplate } from '@/app/(app)/templates/actions';
import { cn } from '@/lib/utils';

const CAT = { marketing: 'Promotional', utility: 'Updates', authentication: 'OTP' } as const;

export function LibraryView({ taken, canEdit }: { taken: string[]; canEdit: boolean }) {
  const router = useRouter();
  const [group, setGroup] = useState<'All' | LibraryGroup>('All');
  const [q, setQ] = useState('');
  const [used, setUsed] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [, start] = useTransition();
  const names = useMemo(() => [...taken, ...used.map((u) => u)], [taken, used]);
  const shown = TEMPLATE_LIBRARY.filter((t) => (group === 'All' || t.group === group) && `${t.title} ${t.when} ${t.draft.body}`.toLowerCase().includes(q.toLowerCase()));

  function use(id: string) {
    const t = TEMPLATE_LIBRARY.find((x) => x.id === id)!;
    setErr(''); setBusy(id);
    start(async () => {
      const name = uniqueTemplateName(t.draft.name, names);
      const r = await saveTemplate({ ...t.draft, name });
      setBusy('');
      if (!r.ok) { setErr(r.error); return; }
      setUsed((u) => [...u, name]);
      router.push('/templates');
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div><h2 className="font-display text-2xl font-extrabold">Template library</h2><p className="text-sm text-muted">Ready-made WhatsApp templates. “Use this” saves a draft in Templates. You can change the words, then submit it to WhatsApp for approval. Nothing here is pre-approved.</p></div>
      {err ? <p role="alert" className="rounded-xl bg-rose/10 p-3 text-sm text-rose">{err}</p> : null}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" role="tablist">
        {(['All', ...LIBRARY_GROUPS] as const).map((g) => (
          <button key={g} role="tab" aria-selected={group === g} onClick={() => setGroup(g)} className={cn('min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold', group === g ? 'grad-bg border-transparent text-white' : 'border-line bg-card hover:border-brand/60')}>{g}</button>
        ))}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the library" aria-label="Search the library" className="min-h-11 max-w-md rounded-xl border border-line bg-card px-3 text-sm" />
      {shown.length === 0 ? <p className="py-10 text-center text-sm text-muted">Nothing matches.</p> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((t) => (
            <article key={t.id} className="card flex flex-col gap-3 p-4">
              <div><p className="text-xs font-semibold text-brand">{t.group} · {CAT[t.draft.category]} · {t.draft.language === 'hi' ? 'Hindi' : 'English'}</p><h3 className="font-semibold">{t.title}</h3><p className="text-sm text-muted">{t.when}</p></div>
              <WaBubble header={t.draft.headerText} body={t.draft.body} footer={t.draft.footer} buttons={t.draft.buttons} values={t.draft.samples} />
              {canEdit ? <Button className="mt-auto" variant="soft" disabled={busy !== ''} onClick={() => use(t.id)}>{busy === t.id ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}Use this</Button> : <p className="mt-auto text-xs text-muted">Ask an admin to add this.</p>}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
