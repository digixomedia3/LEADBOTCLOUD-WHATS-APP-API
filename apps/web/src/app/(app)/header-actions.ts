'use server';

import { sql } from 'drizzle-orm';
import { db, requireCtx } from '@/lib/session';

type R = Record<string, unknown>;
const rows = (r: unknown) => r as R[];
const num = (v: unknown) => Number(v ?? 0);

export type Severity = 'critical' | 'warning' | 'info';
export interface Alert { id: string; severity: Severity; title: string; detail: string; href: string; action: string }
export interface HeaderState {
  pill: { tone: 'ok' | 'warn' | 'bad' | 'off'; label: string };
  alerts: Alert[];
}

const PAUSE_TEXT: Record<string, [string, string]> = {
  reconnect: ['Sending paused: WhatsApp needs to be reconnected', 'Your connection expired. Reconnect to continue.'],
  account_restricted: ['Sending paused: Meta restricted your account', 'Check Meta Business Support. Campaigns resume after you start them again.'],
  payment_banner: ['Sending paused: payment problem at Meta', 'Meta could not charge your card. Update the payment method in Meta.'],
  template_paused: ['Sending paused: message format paused by Meta', 'Meta paused the format for low quality. It resumes by itself after the pause.'],
  template_disabled: ['Sending stopped: message format disabled by Meta', 'Create a new message format and use it for this send.'],
  template_not_approved: ['Sending paused: message format not approved', 'Pick an approved message format.'],
  spend_cap: ['Sending paused: spend cap reached', 'The estimated cost is above your cap. Raise the cap or choose fewer people.'],
  not_connected: ['Sending paused: no WhatsApp number connected', 'Connect your number in Settings.'],
  disconnected: ['Sending stopped: WhatsApp was disconnected', 'Reconnect in Settings.'],
  pause_campaign_24h: ['Sending paused for 24 hours', 'Meta asked us to slow down. Check your number quality.'],
  pause_tenant: ['Sending paused', 'Meta blocked sending from this account.'],
};

/** Live header state for the workspace: the connection pill and the alert list. Derived from current data, so there is no stale queue to clear. */
export async function getHeaderState(): Promise<HeaderState> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => {
    const acc = rows(await tx.execute(sql`
      select a.token_status, a.health_state, a.payment_method_status, p.quality_rating, p.status, p.display_phone_number
      from meta_accounts a left join phone_numbers p on p.meta_account_id = a.id order by a.created_at limit 1`))[0];
    const alerts: Alert[] = [];
    let pill: HeaderState['pill'] = { tone: 'off', label: 'Not connected' };

    if (acc) {
      const tokenBad = acc.token_status !== 'valid';
      const restricted = acc.health_state !== 'ok';
      const red = acc.quality_rating === 'RED', yellow = acc.quality_rating === 'YELLOW';
      if (tokenBad) { pill = { tone: 'bad', label: 'Reconnect needed' }; alerts.push({ id: 'token', severity: 'critical', title: 'WhatsApp connection expired', detail: 'Sending is stopped until you reconnect.', href: '/settings', action: 'Reconnect' }); }
      else if (restricted) { pill = { tone: 'bad', label: 'Account restricted' }; alerts.push({ id: 'restricted', severity: 'critical', title: 'Meta restricted your WhatsApp account', detail: 'Campaigns are paused. Check Meta Business Support.', href: '/settings', action: 'See details' }); }
      else if (acc.payment_method_status === 'failing') { pill = { tone: 'bad', label: 'Payment problem' }; alerts.push({ id: 'pay', severity: 'critical', title: 'Meta could not charge your card', detail: 'Update the payment method in Meta, or messages will not send.', href: '/settings', action: 'Fix payment' }); }
      else if (red) { pill = { tone: 'bad', label: 'Quality low' }; alerts.push({ id: 'quality', severity: 'warning', title: 'Your number quality is low', detail: 'Send fewer promotions and only to people who want them, or Meta may limit the number.', href: '/analytics', action: 'See results' }); }
      else if (yellow) { pill = { tone: 'warn', label: 'Quality medium' }; alerts.push({ id: 'quality', severity: 'info', title: 'Your number quality is medium', detail: 'Watch opt-outs and blocks on your next sends.', href: '/analytics', action: 'See results' }); }
      else pill = { tone: 'ok', label: acc.quality_rating === 'GREEN' ? 'Connected · Quality high' : 'Connected' };
    }

    const paused = rows(await tx.execute(sql`select id, name, pause_reason from campaigns where status = 'paused' order by created_at desc limit 5`));
    for (const c of paused) {
      const [title, detail] = PAUSE_TEXT[String(c.pause_reason)] ?? ['Campaign paused', 'Open the campaign to see why.'];
      alerts.push({ id: `camp-${c.id}`, severity: 'warning', title: `${title}`, detail: `“${c.name}”. ${detail}`, href: '/campaigns', action: 'Open' });
    }
    const tpl = rows(await tx.execute(sql`select id, name, status, rejection_reason from templates where (status in ('rejected','paused','disabled')) and updated_at > now() - interval '14 days' order by updated_at desc limit 4`));
    for (const t of tpl) {
      const s = String(t.status);
      alerts.push({ id: `tpl-${t.id}`, severity: s === 'rejected' ? 'warning' : 'warning', title: s === 'rejected' ? `Message format “${t.name}” was rejected` : s === 'paused' ? `Message format “${t.name}” was paused by Meta` : `Message format “${t.name}” was disabled by Meta`, detail: s === 'rejected' ? 'Open it to see the reason and fix it.' : 'It cannot be used until Meta allows it again.', href: '/templates', action: 'Open' });
    }
    const unread = num(rows(await tx.execute(sql`select coalesce(sum(unread),0)::int n from conversations where status = 'open' and unread > 0`))[0]?.n);
    if (unread > 0) alerts.push({ id: 'unread', severity: 'info', title: `${unread} unread ${unread === 1 ? 'message' : 'messages'}`, detail: 'Customers are waiting for a reply.', href: '/chats', action: 'Open chats' });
    const od = rows(await tx.execute(sql`select count(*)::int n, coalesce(sum(amount_paise),0)::bigint p from renewals where status not in ('renewed','cancelled') and due_on::date < (now() at time zone 'Asia/Kolkata')::date`))[0];
    if (num(od?.n) > 0) alerts.push({ id: 'overdue', severity: 'info', title: `${num(od?.n)} ${num(od?.n) === 1 ? 'renewal is' : 'renewals are'} overdue`, detail: `₹${(num(od?.p) / 100).toLocaleString('en-IN')} is waiting to be collected.`, href: '/renewals', action: 'Remind' });

    const order = { critical: 0, warning: 1, info: 2 } as const;
    alerts.sort((a, b) => order[a.severity] - order[b.severity]);
    return { pill, alerts };
  });
}
