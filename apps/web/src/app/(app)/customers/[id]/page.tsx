import { notFound } from 'next/navigation';
import Link from 'next/link';
import { customers, chats } from '@/lib/demo-data';
import { PageHeader } from '@/components/page-header';
import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DemoBanner } from '@/components/demo-banner';

export function generateStaticParams() {
  return customers.map((c) => ({ id: c.id }));
}

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = customers.find((x) => x.id === id);
  if (!c) notFound();
  const hasChat = chats.some((x) => x.id === c.id);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={c.name} subtitle={c.phone} back={{ href: '/customers', label: 'Customers' }} />
      <DemoBanner />
      <Card>
        <CardTitle>Permission to message</CardTitle>
        <div className="mt-2 flex items-center gap-2">
          <Badge tone={c.consent === 'allowed' ? 'green' : c.consent === 'stopped' ? 'red' : 'amber'}>
            {c.consent === 'allowed' ? 'Allowed messages' : c.consent === 'stopped' ? 'Stopped messages' : 'Permission not recorded'}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">Source: {c.source}</p>
        {c.consent !== 'allowed' ? (
          <p className="mt-2 text-sm">
            {c.consent === 'stopped'
              ? 'This customer asked to stop. They are left out of every bulk send. They can restart by sending START.'
              : 'Add proof of permission before including this customer in a bulk send.'}
          </p>
        ) : null}
      </Card>
      <Card>
        <CardTitle>Tags</CardTitle>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {c.tags.length ? c.tags.map((t) => <Badge key={t} tone="blue">{t}</Badge>) : <span className="text-sm text-muted-foreground">No tags yet</span>}
        </div>
      </Card>
      {c.renewal ? (
        <Card>
          <CardTitle>Renewal</CardTitle>
          <p className="mt-2 text-sm">{c.renewal}</p>
          <Button asChild variant="outline" size="sm" className="mt-3"><Link href="/renewals">See renewals</Link></Button>
        </Card>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {hasChat ? <Button asChild><Link href={`/chats/${c.id}`}>Open chat</Link></Button> : null}
        <Button variant="outline">Export this customer&apos;s data</Button>
        <Button variant="outline">Erase customer</Button>
      </div>
    </div>
  );
}
