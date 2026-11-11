import type { Metadata } from 'next';
import { i18n } from '@lbc/shared';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: i18n.en.legal.terms };

export default function Page() {
  return <LegalPage title={i18n.en.legal.terms} />;
}
