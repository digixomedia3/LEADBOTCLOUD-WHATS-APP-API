import { i18n } from '@lbc/shared';
import { EmptyState } from '@/components/empty-state';

const t = i18n.en.pages;

export default function SendPage() {
  return <EmptyState title={t.send.title} hint={t.send.hint} />;
}
