import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';
import { messagingPolicy } from '@/components/legal/content';

export const metadata: Metadata = { title: 'Messaging and opt-in policy', alternates: { canonical: '/messaging-policy' } };
// Reads company details from the environment at request time, so a change needs no rebuild.
export const dynamic = 'force-dynamic';

export default function Page() {
  const p = messagingPolicy();
  return <LegalPage current="/messaging-policy" title={p.title} intro={p.intro} sections={p.sections} />;
}
