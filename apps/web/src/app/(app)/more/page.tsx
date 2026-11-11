import Link from 'next/link';
import { i18n } from '@lbc/shared';
import { Card } from '@/components/ui/card';

const t = i18n.en;

export default function MorePage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t.nav.more}</h1>
      <Card className="flex flex-col divide-y divide-border p-0">
        {(
          [
            ['/terms', t.legal.terms],
            ['/privacy', t.legal.privacy],
            ['/contact', t.legal.contact],
          ] as const
        ).map(([href, label]) => (
          <Link key={href} href={href} className="flex min-h-11 items-center px-4 text-sm font-medium">
            {label}
          </Link>
        ))}
      </Card>
    </div>
  );
}
