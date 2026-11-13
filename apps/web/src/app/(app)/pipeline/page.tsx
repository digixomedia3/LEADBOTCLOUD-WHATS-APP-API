import type { Metadata } from 'next';
import { PipelineView } from '@/components/pipeline/pipeline-view';
import { requireCtx } from '@/lib/session';
import { loadPipeline } from './actions';

export const metadata: Metadata = { title: 'Pipeline' };
export const dynamic = 'force-dynamic';

export default async function PipelinePage() {
  const ctx = await requireCtx();
  const p = await loadPipeline(false);
  return <PipelineView initial={p.cards} truncated={p.truncated} canWrite={ctx.role !== 'viewer'} />;
}
