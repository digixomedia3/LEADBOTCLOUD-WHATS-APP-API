import type { Metadata } from 'next';
import { CampaignsView } from '@/components/campaigns/campaigns-view';
import { requireCtx } from '@/lib/session';
import { listGroups } from '../contacts/actions';
import { listTemplates } from '../templates/actions';
import { listCampaigns } from './actions';

export const metadata: Metadata = { title: 'Campaigns' };
export const dynamic = 'force-dynamic';

export default async function CampaignsPage() {
  const ctx = await requireCtx();
  const [rows, templates, groups] = await Promise.all([listCampaigns(), listTemplates(), listGroups()]);
  return <CampaignsView initial={rows} templates={templates} groups={groups} canEdit={ctx.role === 'owner' || ctx.role === 'admin'} appUrl={(process.env.APP_URL ?? '').replace(/\/+$/, '')} />;
}
