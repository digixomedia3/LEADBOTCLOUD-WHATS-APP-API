import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';
import { refunds } from '@/components/legal/content';

export const metadata: Metadata = { title: 'Refund and Cancellation Policy', alternates: { canonical: '/refunds' } };
// Reads company details from the environment at request time, so a change needs no rebuild.
export const dynamic = 'force-dynamic';

export default function Page() {
  const p = refunds();
  return <LegalPage current="/refunds" title={p.title} intro={p.intro} sections={p.sections} />;
}
