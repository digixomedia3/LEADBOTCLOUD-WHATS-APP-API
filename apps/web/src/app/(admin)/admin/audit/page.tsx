import Link from 'next/link';
import { AuditList } from '@/components/admin/admin-views';
import { loadAudit } from '../actions';

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant } = await searchParams; const t = typeof tenant === 'string' ? tenant : '';
  const r = await loadAudit(null, t, '');
  if (!r.ok) return <p role="alert" className="rounded-xl bg-rose/10 p-4 text-rose">{r.error}</p>;
  return <div className="flex flex-col gap-4"><h1 className="font-display text-2xl font-bold">Audit log</h1>{t ? <p className="text-sm text-muted">Showing one workspace. <Link className="underline" href="/admin/audit">Show all</Link></p> : null}<AuditList key={t} initial={r.data} tenant={t} /></div>;
}
