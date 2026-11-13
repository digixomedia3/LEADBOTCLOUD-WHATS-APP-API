import type { Metadata } from 'next';
import { ConnectionsView } from '@/components/connections/connections-view';
import { listConnections } from './actions';

export const metadata: Metadata = { title: 'Connections' };
export const dynamic = 'force-dynamic';

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; pick?: string }> }) {
  const sp = await searchParams;
  return <ConnectionsView initial={await listConnections()} flash={{ ok: sp.ok ?? null, err: sp.err ?? null, pick: sp.pick ?? null }} />;
}
