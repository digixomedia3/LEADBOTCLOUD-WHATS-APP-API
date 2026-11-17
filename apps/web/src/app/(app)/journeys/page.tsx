import type { Metadata } from 'next';
import { JourneysView } from '@/components/journeys/journeys-view';
import { isLive } from '@/lib/core/campaigns';
import { requireCtx } from '@/lib/session';
import { listGroups } from '../contacts/actions';
import { listJourneys, listLeadSources, listTemplateChoices } from './actions';

export const metadata: Metadata = { title: 'Journeys' };
export const dynamic = 'force-dynamic';

export default async function JourneysPage() {
  const ctx = await requireCtx();
  const [initial, templates, groups, sources, live] = await Promise.all([listJourneys(), listTemplateChoices(), listGroups(), listLeadSources(), isLive(ctx)]);
  return <JourneysView initial={initial} templates={templates} groups={groups.map((g) => ({ id: g.id, name: g.name, count: g.count }))} sources={sources} canEdit={ctx.role === 'owner' || ctx.role === 'admin'} live={live} />;
}
