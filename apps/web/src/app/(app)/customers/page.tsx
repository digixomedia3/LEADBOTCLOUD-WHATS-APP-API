import { i18n } from '@lbc/shared';
import { EmptyState } from '@/components/empty-state';

const t = i18n.en.pages;

export default function CustomersPage() {
  return <EmptyState title={t.customers.title} hint={t.customers.hint} />;
}
