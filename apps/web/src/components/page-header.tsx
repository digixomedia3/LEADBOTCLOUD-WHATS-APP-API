import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

/** The top bar already shows the section title, so the heading only appears on phones or on sub-pages with a back link. */
export function PageHeader({
  title,
  subtitle,
  action,
  back,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-4 flex flex-col gap-2">
      {back ? (
        <Link href={back.href} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground">
          <ChevronLeft className="size-4" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className={back ? 'text-xl font-bold' : 'text-xl font-bold md:hidden'}>{title}</h2>
          {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
      </div>
    </div>
  );
}
