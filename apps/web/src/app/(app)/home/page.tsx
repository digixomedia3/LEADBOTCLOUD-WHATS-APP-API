import { i18n } from '@lbc/shared';
import { Card, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';

const t = i18n.en.pages;

// Spec A4.11: four primary cards. Real data arrives with later modules; these are honest empty states.
export default function HomePage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t.home.title}</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardTitle>{t.home.spend}</CardTitle>
          <p className="mt-2 text-2xl font-bold">₹0</p>
          <p className="text-xs text-muted-foreground">{t.home.spendHint}</p>
        </Card>
        <Card>
          <CardTitle>{t.home.lastSend}</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">{t.home.lastSendHint}</p>
        </Card>
        <Card>
          <CardTitle>{t.home.health}</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">{t.home.healthHint}</p>
        </Card>
        <Card>
          <CardTitle>{t.home.pending}</CardTitle>
          <p className="mt-2 text-2xl font-bold">0</p>
          <p className="text-xs text-muted-foreground">{t.home.pendingHint}</p>
        </Card>
      </div>
      <EmptyState
        title={t.home.setupTitle}
        hint={t.home.setupHint}
        actionLabel={t.home.setupAction}
        actionHref="/more"
      />
    </div>
  );
}
