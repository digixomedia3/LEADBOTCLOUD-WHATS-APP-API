import type { Metadata } from 'next';
import { TemplatesView } from '@/components/templates/templates-view';
import { requireCtx } from '@/lib/session';
import { listTemplates } from './actions';

export const metadata: Metadata = { title: 'Templates' };
export const dynamic = 'force-dynamic';

export default async function TemplatesPage() {
  const ctx = await requireCtx();
  return <TemplatesView initial={await listTemplates()} canEdit={ctx.role === 'owner' || ctx.role === 'admin'} appUrl={(process.env.APP_URL ?? '').replace(/\/+$/, '')} />;
}
