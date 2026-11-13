import type { Metadata } from 'next';
import { LibraryView } from '@/components/templates/library-view';
import { requireCtx } from '@/lib/session';
import { listTemplates } from '../templates/actions';

export const metadata: Metadata = { title: 'Template library' };
export const dynamic = 'force-dynamic';

export default async function TemplateLibraryPage() {
  const ctx = await requireCtx();
  const taken = (await listTemplates()).map((t) => t.name);
  return <LibraryView taken={taken} canEdit={ctx.role === 'owner' || ctx.role === 'admin'} />;
}
