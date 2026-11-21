import 'server-only';
import { layout, sendMail, mailConfigured } from '@/lib/mail';
import { company } from '@/lib/company';

/**
 * The emails the product sends on its own, in one place so the wording and the rules are easy to check.
 * Every function answers { sent }: true only when a real transport (SMTP) accepted the message. With the console transport nothing
 * reaches anyone, so the caller must not tell the user "we emailed them" and keeps showing the link to share by hand.
 * A failure never breaks the action that caused it (the invite exists, the closure is requested): it is logged by sendMail.
 */
export interface Sent { sent: boolean }

/** Names come from users. Strip line breaks and control characters so a name can never start a new line in a header or look like one in the body. */
const oneLine = (v: string, max = 120) => v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const baseUrl = () => (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const dateIn = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
const footer = () => { const c = company(); return c.supportEmail ? `Questions? Write to ${c.supportEmail}.` : 'LeadBotCloud'; };

async function deliver(to: string, subject: string, m: { text: string; html: string }): Promise<Sent> {
  const r = await sendMail({ to, subject, text: m.text, html: m.html });
  return { sent: r.ok && r.transport === 'smtp' };
}

export async function sendInviteMail(raw: { to: string; workspace: string; inviter: string; role: string; token: string; expiresAt: Date }): Promise<Sent> {
  const a = { ...raw, workspace: oneLine(raw.workspace), inviter: oneLine(raw.inviter, 80) };
  const role = a.role === 'admin' ? 'an Admin' : a.role === 'agent' ? 'an Agent' : 'a Viewer';
  const m = layout({
    heading: `${a.inviter} invited you to ${a.workspace}`,
    lines: [
      `${a.inviter} added you to the "${a.workspace}" workspace on LeadBotCloud as ${role}.`,
      `Open the link below and sign in, or create an account, using this email address (${a.to}). The invitation only works for this address, works once, and expires on ${dateIn(a.expiresAt)}.`,
      'If you were not expecting this, you can ignore this email. Nothing happens unless you accept.',
    ],
    button: { label: 'Accept the invitation', url: `${baseUrl()}/invite/${a.token}` },
    footer: footer(),
  });
  return deliver(a.to, `${a.inviter} invited you to ${a.workspace} on LeadBotCloud`, m);
}

export async function sendClosureRequestedMail(raw: { to: string; workspace: string; dueAt: Date }): Promise<Sent> {
  const a = { ...raw, workspace: oneLine(raw.workspace) };
  const m = layout({
    heading: `${a.workspace} will be closed on ${dateIn(a.dueAt)}`,
    lines: [
      `You asked to close the "${a.workspace}" workspace. On ${dateIn(a.dueAt)} all of its contacts, chats, templates, campaigns and files will be permanently deleted. This cannot be undone after that date.`,
      'Until then you can change your mind: open Settings, go to Business, and press Cancel closing. You can also download your data from the same page.',
      'If you did not ask for this, sign in now, cancel the closing, and change your password.',
    ],
    button: { label: 'Open Settings', url: `${baseUrl()}/settings` },
    footer: footer(),
  });
  return deliver(a.to, `Your LeadBotCloud workspace will be closed on ${dateIn(a.dueAt)}`, m);
}

export async function sendClosureCancelledMail(raw: { to: string; workspace: string }): Promise<Sent> {
  const a = { ...raw, workspace: oneLine(raw.workspace) };
  const m = layout({
    heading: `${a.workspace} will stay open`,
    lines: [`The closing of the "${a.workspace}" workspace was cancelled. Nothing will be deleted.`, 'If you did not do this, change your password and check the Activity log in your workspace.'],
    button: { label: 'Open LeadBotCloud', url: `${baseUrl()}/dashboard` },
    footer: footer(),
  });
  return deliver(a.to, 'Your LeadBotCloud workspace will stay open', m);
}

/** What the screen can honestly say about delivery. */
export function mailMode(): 'smtp' | 'console' { return mailConfigured(); }
