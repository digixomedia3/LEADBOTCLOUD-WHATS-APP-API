import type { Metadata } from 'next';
import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { formatPhone } from '@lbc/shared';
import { db, requireCtx } from '@/lib/session';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Opt-outs and consent' };
export const dynamic = 'force-dynamic';

type Row = { name: string | null; phone_e164: string; consent_status: string; opt_out_at: string | null; opt_out_source: string | null; consent_source: string | null; consent_at: string | null };
const FILTERS = [['out', 'Opted out'], ['in', 'Can message'], ['unknown', 'No consent on record']] as const;
const when = (d: string | null) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '—');

export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const f = FILTERS.find(([k]) => k === sp.f)?.[0] ?? 'out';
  const q = (sp.q ?? '').trim().slice(0, 60);
  const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
  const { rows, counts } = await db(ctx, async (tx) => {
    const status = f === 'out' ? sql`consent_status = 'stopped'` : f === 'in' ? sql`consent_status = 'allowed'` : sql`consent_status not in ('stopped', 'allowed')`;
    const rows = (await tx.execute(sql`select name, phone_e164, consent_status, opt_out_at, opt_out_source, consent_source, consent_at from contacts
      where ${status} and (${q} = '' or coalesce(name, '') ilike ${like} or phone_e164 ilike ${like}) order by coalesce(opt_out_at, consent_at, created_at) desc limit 200`)) as unknown as Row[];
    const counts = (await tx.execute(sql`select count(*) filter (where consent_status = 'stopped')::int as out, count(*) filter (where consent_status = 'allowed')::int as inn, count(*) filter (where consent_status not in ('stopped', 'allowed'))::int as unknown from contacts`))[0] as { out: number; inn: number; unknown: number };
    return { rows, counts };
  });
  const c: Record<string, number> = { out: counts.out, in: counts.inn, unknown: counts.unknown };
  return (
    <div className="flex flex-col gap-5">
      <div><h2 className="font-display text-2xl font-extrabold">Opt-outs and consent</h2><p className="text-sm text-muted">Anyone who replies STOP is never sent a campaign again, whatever list they are on.</p></div>
      <div className="flex flex-wrap gap-2" role="tablist">
        {FILTERS.map(([k, l]) => (
          <Link key={k} href={`/consent?f=${k}${q ? `&q=${encodeURIComponent(q)}` : ''}`} role="tab" aria-selected={f === k} className={cn('min-h-10 rounded-full px-4 py-2 text-sm font-semibold', f === k ? 'grad-bg text-white' : 'bg-card ring-1 ring-line hover:ring-brand/60')}>{l} <span className="opacity-80">{c[k]}</span></Link>
        ))}
      </div>
      <form className="flex max-w-md gap-2"><input type="hidden" name="f" value={f} /><input name="q" defaultValue={q} placeholder="Search name or number" aria-label="Search" className="min-h-11 w-full rounded-xl border border-line bg-card px-3 text-sm" /></form>
      {rows.length === 0 ? <div className="card p-8 text-center text-sm text-muted">Nobody here{q ? ' matches that search' : ' yet'}.</div> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-muted"><tr><th className="p-3">Contact</th><th className="p-3">{f === 'out' ? 'Opted out' : 'Consent given'}</th><th className="p-3">{f === 'out' ? 'How' : 'Source'}</th></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.phone_e164}><td className="p-3"><p className="font-medium">{r.name ?? 'No name'}</p><p className="text-xs text-muted">{formatPhone(r.phone_e164)}</p></td><td className="p-3">{f === 'out' ? when(r.opt_out_at) : when(r.consent_at)}</td><td className="p-3 text-muted">{(f === 'out' ? r.opt_out_source : r.consent_source)?.replace(/_/g, ' ') ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length === 200 ? <p className="text-xs text-muted">Showing the latest 200. Use search to find someone specific.</p> : null}
    </div>
  );
}
