import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';
import { acceptableUse } from '@/components/legal/content';

export const metadata: Metadata = { title: 'Acceptable Use Policy', alternates: { canonical: '/acceptable-use' } };
// Reads company details from the environment at request time, so a change needs no rebuild.
export const dynamic = 'force-dynamic';

export default function Page() {
  const p = acceptableUse();
  return <LegalPage current="/acceptable-use" title={p.title} intro={p.intro} sections={p.sections} />;
}
