import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';
import { terms } from '@/components/legal/content';

export const metadata: Metadata = { title: 'Terms of Service', alternates: { canonical: '/terms' } };
// Reads company details from the environment at request time, so a change needs no rebuild.
export const dynamic = 'force-dynamic';

export default function Page() {
  const p = terms();
  return <LegalPage current="/terms" title={p.title} intro={p.intro} sections={p.sections} />;
}
