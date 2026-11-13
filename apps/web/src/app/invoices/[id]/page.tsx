import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { PLAN_LIMITS } from '@lbc/shared';
import { company } from '@/lib/company';
import { db, requireCtx } from '@/lib/session';
import { PrintButton } from './print-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tax invoice', robots: { index: false } };

const inr = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const d = (x: string | Date | null) => (x ? new Date(x).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');
interface InvoiceRow { number: string; plan: string; base_paise: number; gst_paise: number; total_paise: number; issued_at: string; period_start: string | null; period_end: string | null; buyer_name: string; buyer_gstin: string | null; razorpay_payment_id: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A GST tax invoice for one payment. Read through RLS as the signed-in workspace member, so someone else's invoice id is a 404, not a leak.
 * The seller details come from the environment; anything missing is shown as missing rather than invented.
 */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireCtx();
  const inv = ((await db(ctx, (tx) => tx.execute(sql`select * from invoices where id = ${id}`))) as unknown as InvoiceRow[])[0];
  if (!inv) notFound();
  const c = company();
  const gstin = c.gstin;
  const plan = PLAN_LIMITS[inv.plan as 'free']?.label ?? inv.plan;
  return (
    <main className="min-h-screen bg-white p-4 text-slate-900 sm:p-10 print:min-h-0 print:p-0"><div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/settings" className="text-sm text-slate-500 underline">Back to settings</Link>
        <PrintButton />
      </div>
      <div className="rounded-xl border border-slate-200 p-6 sm:p-8 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">TAX INVOICE</h1>
            <p className="mt-1 text-sm text-slate-500">Invoice no. <strong className="text-slate-900">{inv.number}</strong></p>
            <p className="text-sm text-slate-500">Date: {d(inv.issued_at)}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-bold">{c.legalName}</p>
            <p className="text-slate-500">{c.address ?? 'Address not set (COMPANY_ADDRESS)'}</p>
            <p className="text-slate-500">{gstin ? `GSTIN: ${gstin}` : 'GSTIN not set (COMPANY_GSTIN)'}</p>
          </div>
        </header>
        <section className="grid gap-5 border-b border-slate-200 py-5 text-sm sm:grid-cols-2">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Billed to</p><p className="mt-1 font-semibold">{inv.buyer_name}</p>{inv.buyer_gstin ? <p className="text-slate-500">GSTIN: {inv.buyer_gstin}</p> : <p className="text-slate-500">GSTIN: not provided</p>}</div>
          <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Service</p><p className="mt-1">LeadBotCloud {plan} plan, monthly subscription</p>{inv.period_start && inv.period_end ? <p className="text-slate-500">Period: {d(inv.period_start)} to {d(inv.period_end)}</p> : null}<p className="text-slate-500">SAC 998439 (online content and software services)</p></div>
        </section>
        <table className="mt-5 w-full text-sm">
          <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-2 font-semibold">Description</th><th className="py-2 text-right font-semibold">Amount</th></tr></thead>
          <tbody>
            <tr className="border-b border-slate-100"><td className="py-2">LeadBotCloud {plan} (taxable value)</td><td className="py-2 text-right">{inr(inv.base_paise)}</td></tr>
            <tr className="border-b border-slate-100"><td className="py-2">GST @ 18%</td><td className="py-2 text-right">{inr(inv.gst_paise)}</td></tr>
            <tr><td className="py-3 font-bold">Total paid</td><td className="py-3 text-right text-lg font-extrabold">{inr(inv.total_paise)}</td></tr>
          </tbody>
        </table>
        <p className="mt-4 text-xs text-slate-500">Paid online via Razorpay (payment {inv.razorpay_payment_id}). Place of supply and the CGST/SGST or IGST split follow your registered state; confirm with your accountant before filing.</p>
        <p className="mt-2 text-xs text-slate-400">This is a computer-generated invoice and needs no signature.</p>
      </div>
    </div></main>
  );
}
