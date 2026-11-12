import type { Metadata } from 'next';
import { AutomationView } from '@/components/automation/automation-view';
import { requireCtx } from '@/lib/session';
import { listRules } from './actions';

export const metadata: Metadata = { title: 'Auto-replies' };
export const dynamic = 'force-dynamic';

export default async function AutomationPage() {
  const ctx = await requireCtx();
  return <AutomationView initial={await listRules()} canEdit={ctx.role === 'owner' || ctx.role === 'admin'} plan={ctx.workspace.plan} />;
}
