import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';
import { privacy } from '@/components/legal/content';

export const metadata: Metadata = { title: 'Privacy Policy', alternates: { canonical: '/privacy' } };
// Reads company details from the environment at request time, so a change needs no rebuild.
export const dynamic = 'force-dynamic';

export default function Page() {
  const p = privacy();
  return <LegalPage current="/privacy" title={p.title} intro={p.intro} sections={p.sections} />;
}
