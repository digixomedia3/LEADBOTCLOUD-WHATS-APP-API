import { Accounts } from '@/components/admin/admin-views-2';
import { searchUsers } from '../actions';

export default async function AccountsPage() {
  const r = await searchUsers('');
  if (!r.ok) return <p role="alert" className="rounded-xl bg-rose/10 p-4 text-rose">{r.error}</p>;
  return <div className="flex flex-col gap-4"><div><h1 className="font-display text-2xl font-bold">People</h1><p className="text-sm text-muted">Find a person, see their workspaces, and end their sign-ins if their phone was lost or an account looks taken over.</p></div><Accounts initial={r.data} /></div>;
}
