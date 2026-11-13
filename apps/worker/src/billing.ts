import { sql } from 'drizzle-orm';
import type { Db } from '@lbc/db';
import { BillingEvent, HANDLED_EVENTS, dedupeKey, verifyWebhookSignature } from '@lbc/razorpay';
import { financialYear, invoiceNumber, isPaidPlan, splitInclusive } from '@lbc/shared';

type Row = Record<string, any>;
const rows = async (db: Db, q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as Row[];

export interface BillingIngest { status: 200 | 401 | 503; id: number | null; duplicate: boolean }

/**
 * Receiver half (same contract as the Meta receiver): verify the signature on the RAW bytes, store with a dedupe key, return.
 * A bad signature is recorded (so an attack is visible) but never processed and never changes anything.
 */
export async function ingestBilling(db: Db, raw: Buffer, signature: string | undefined, eventId: string | undefined, secret: string | undefined): Promise<BillingIngest> {
  if (!secret) return { status: 503, id: null, duplicate: false };
  const text = raw.toString('utf8');
  if (!verifyWebhookSignature(raw, signature, secret)) {
    await db.execute(sql`insert into billing_events (dedupe_key, signature_ok, payload) values (${`bad:${Date.now()}:${Math.random().toString(36).slice(2)}`}, false, ${JSON.stringify({ note: 'signature mismatch', bytes: raw.length })}::jsonb)`);
    return { status: 401, id: null, duplicate: false };
  }
  let body: unknown = {}; try { body = JSON.parse(text); } catch { /* validated signature but not JSON: store as-is for review */ }
  const b = body as { event?: string; payload?: { subscription?: { entity?: { id?: string } } } };
  const r = await rows(db, sql`insert into billing_events (dedupe_key, signature_ok, event, razorpay_subscription_id, payload)
    values (${dedupeKey(eventId, text)}, true, ${b.event ?? null}, ${b.payload?.subscription?.entity?.id ?? null}, ${JSON.stringify(body)}::jsonb)
    on conflict (dedupe_key) do nothing returning id`);
  return r[0] ? { status: 200, id: Number(r[0].id), duplicate: false } : { status: 200, id: null, duplicate: true };
}

/** Subscription states that mean "the customer no longer has a paid plan". */
const ENDED = new Set(['cancelled', 'completed', 'expired', 'halted']);
const toDate = (s?: number | null) => (s ? new Date(s * 1000) : null);
/** The SQL template cannot bind a JS Date with this driver, so timestamps go in as ISO text with an explicit cast. */
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export type Outcome = 'applied' | 'ignored' | 'stale' | 'invoiced' | 'duplicate_payment';

/**
 * Applies ONE stored event. Throws when it cannot yet be applied (e.g. the webhook raced ahead of our own subscription row) so the queue retries.
 * Rules: the workspace is found from OUR subscriptions row (never from webhook notes); an older event never overwrites a newer state;
 * a paid plan is granted only on active/charged and removed when the subscription ends; each captured payment makes exactly one invoice.
 */
export async function processBillingEvent(db: Db, id: number): Promise<Outcome> {
  const ev = (await rows(db, sql`select * from billing_events where id = ${id}`))[0];
  if (!ev) return 'ignored';
  if (!ev.signature_ok || ev.processed_at) return 'ignored';
  const parsed = BillingEvent.safeParse(ev.payload);
  if (!parsed.success) { await finish(db, id, 'unparseable event'); return 'ignored'; }
  const e = parsed.data;
  if (!HANDLED_EVENTS.has(e.event) || !e.payload.subscription) { await finish(db, id); return 'ignored'; }

  const rs = e.payload.subscription.entity;
  const sub = (await rows(db, sql`select * from subscriptions where razorpay_subscription_id = ${rs.id}`))[0];
  if (!sub) throw new Error(`unknown_subscription ${rs.id}`); // may simply not be committed yet; the queue retries with backoff

  const eventAt = toDate(e.created_at) ?? new Date();
  let outcome: Outcome = 'applied';

  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    // Lock this workspace's subscription so two events for it are applied one after the other.
    const cur = (await rows(t, sql`select * from subscriptions where id = ${sub.id} for update`))[0]!;
    const stale = cur.last_event_at && eventAt < new Date(cur.last_event_at);

    // The plan a Razorpay plan id stands for (we created these plans ourselves); fall back to what checkout recorded.
    const mapped = (await rows(t, sql`select plan from razorpay_plans where razorpay_plan_id = ${rs.plan_id}`))[0]?.plan as string | undefined;
    const plan = mapped && isPaidPlan(mapped) ? mapped : cur.plan;

    // A payment becomes an invoice even if the event is late: money received must always be invoiced. Idempotent on the payment id.
    const pay = e.payload.payment?.entity;
    if (e.event === 'subscription.charged' && pay && (pay.status === 'captured' || pay.status == null)) {
      const exists = (await rows(t, sql`select 1 from invoices where razorpay_payment_id = ${pay.id}`))[0];
      if (exists) outcome = 'duplicate_payment';
      else {
        const when = new Date(), fy = financialYear(when);
        const seq = Number((await rows(t, sql`insert into invoice_counters (fy, last_seq) values (${fy}, 1) on conflict (fy) do update set last_seq = invoice_counters.last_seq + 1 returning last_seq`))[0]!.last_seq);
        const ten = (await rows(t, sql`select name, legal_name, gstin from tenants where id = ${cur.tenant_id}`))[0]!;
        const s = splitInclusive(pay.amount);
        await t.execute(sql`insert into invoices (tenant_id, number, fy, seq, razorpay_payment_id, razorpay_invoice_id, plan, base_paise, gst_paise, total_paise, period_start, period_end, buyer_name, buyer_gstin, issued_at)
          values (${cur.tenant_id}, ${invoiceNumber(fy, seq)}, ${fy}, ${seq}, ${pay.id}, ${pay.invoice_id ?? null}, ${plan}, ${s.basePaise}, ${s.gstPaise}, ${s.totalPaise}, ${iso(toDate(rs.current_start))}::timestamptz, ${iso(toDate(rs.current_end))}::timestamptz, ${ten.legal_name ?? ten.name}, ${ten.gstin ?? null}, ${iso(when)}::timestamptz)`);
        outcome = 'invoiced';
      }
    }

    if (stale) { if (outcome === 'applied') outcome = 'stale'; return; }

    const status = rs.status;
    const pendingDone = cur.pending_plan && cur.pending_plan === plan ? null : cur.pending_plan;
    await t.execute(sql`update subscriptions set status = ${status}, plan = ${plan}, razorpay_plan_id = ${rs.plan_id}, razorpay_customer_id = ${rs.customer_id ?? cur.razorpay_customer_id},
      current_start = ${iso(toDate(rs.current_start))}::timestamptz, current_end = ${iso(toDate(rs.current_end))}::timestamptz, paid_count = ${rs.paid_count ?? cur.paid_count}, pending_plan = ${pendingDone},
      cancel_at_cycle_end = ${ENDED.has(status) ? false : cur.cancel_at_cycle_end}, last_event_at = ${iso(eventAt)}::timestamptz, updated_at = now() where id = ${sub.id}`);

    // Entitlement. active/authenticated-with-a-payment grants the plan; an ended subscription returns the workspace to free. Data is never deleted.
    const grant = (status === 'active' && (e.event === 'subscription.activated' || e.event === 'subscription.charged' || e.event === 'subscription.updated' || e.event === 'subscription.resumed'));
    if (grant) {
      await t.execute(sql`update tenants set plan_id = ${plan}, updated_at = now() where id = ${cur.tenant_id}`);
      await t.execute(sql`insert into audit_log (tenant_id, actor_type, action, entity, entity_id, after) values (${cur.tenant_id}, 'system', 'billing.plan_granted', 'tenant', ${String(cur.tenant_id)}, ${JSON.stringify({ plan, event: e.event })}::jsonb)`);
    } else if (ENDED.has(status)) {
      await t.execute(sql`update tenants set plan_id = 'free', updated_at = now() where id = ${cur.tenant_id}`);
      await t.execute(sql`insert into audit_log (tenant_id, actor_type, action, entity, entity_id, after) values (${cur.tenant_id}, 'system', 'billing.plan_ended', 'tenant', ${String(cur.tenant_id)}, ${JSON.stringify({ status, event: e.event })}::jsonb)`);
    }
  });

  await finish(db, id);
  return outcome;
}

const finish = (db: Db, id: number, error?: string) =>
  db.execute(sql`update billing_events set processed_at = now(), process_error = ${error ?? null}, attempts = attempts + 1 where id = ${id}`);
