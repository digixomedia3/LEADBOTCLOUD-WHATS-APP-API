import { notFound } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Hammer } from 'lucide-react';
import { allNav } from '@/lib/nav';
import { Button } from '@/components/ui/button';

export function generateStaticParams() {
  return allNav.filter((n) => !n.built).map((n) => ({ section: n.href.slice(1) }));
}

/** Honest placeholder for sections that are planned but not built yet. */
export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const item = allNav.find((n) => n.href === `/${section}` && !n.built);
  if (!item) notFound();
  const { Icon } = item;
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 py-10 text-center">
      <span className="grad-bg flex size-20 items-center justify-center rounded-3xl text-white shadow-xl shadow-emerald-500/30"><Icon className="size-9" /></span>
      <div>
        <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-amber/15 px-3 py-1 text-xs font-bold text-amber"><Hammer className="size-3.5" />Being built next</p>
        <h2 className="font-display text-3xl font-extrabold">{item.label}</h2>
        <p className="mt-2 text-muted">{item.blurb}</p>
      </div>
      <ul className="card w-full divide-y divide-line text-left">
        {item.bullets.map((b) => (
          <li key={b} className="flex items-center gap-3 px-4 py-3 text-sm"><CheckCircle2 className="size-5 shrink-0 text-brand" />{b}</li>
        ))}
      </ul>
      <Button asChild variant="outline"><Link href="/dashboard">Back to Dashboard</Link></Button>
    </div>
  );
}
