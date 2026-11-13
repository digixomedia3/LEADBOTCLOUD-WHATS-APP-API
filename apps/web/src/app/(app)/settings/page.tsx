import type { Metadata } from 'next';
import { SettingsView } from '@/components/settings/settings-view';
import { requireCtx } from '@/lib/session';
import { loadProfile, loadTeam } from './actions';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const ctx = await requireCtx();
  const [team, profile] = await Promise.all([loadTeam(), loadProfile()]);
  return <SettingsView team={team} profile={profile} role={ctx.role} me={ctx.user.id} />;
}
