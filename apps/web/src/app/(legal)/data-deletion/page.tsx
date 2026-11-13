import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';
import { dataDeletion } from '@/components/legal/content';

export const metadata: Metadata = { title: 'Data deletion', alternates: { canonical: '/data-deletion' } };
// Reads company details from the environment at request time, so a change needs no rebuild.
export const dynamic = 'force-dynamic';

export default function Page() {
  const p = dataDeletion();
  return <LegalPage current="/data-deletion" title={p.title} intro={p.intro} sections={p.sections} />;
}
