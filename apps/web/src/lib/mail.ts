import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Transactional email (password reset, invitations). One small interface, two transports:
 *   MAIL_TRANSPORT=console  prints the message to the server log. For development; the link is visible to the developer only.
 *   MAIL_TRANSPORT=smtp     sends through SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS, from MAIL_FROM.
 * Mail is never required for the request to succeed: a send failure is logged (without the link) and the caller still answers
 * the same way, so the form can not be used to find out whether an address has an account.
 */
export interface Mail { to: string; subject: string; text: string; html?: string }

// One connection pool per distinct set of settings. Keyed on the settings (not created once and kept forever) so that a changed host, port or
// rotated password is picked up by the next mail instead of silently using the old connection until the process restarts.
let cached: { key: string; t: Transporter } | null = null;
function smtp(): Transporter {
  const port = Number(process.env.SMTP_PORT || 465);
  const key = [process.env.SMTP_HOST, port, process.env.SMTP_USER, process.env.SMTP_PASS].join('\u0000');
  if (cached?.key === key) return cached.t;
  cached?.t.close();
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
  });
  cached = { key, t };
  return t;
}

export function mailConfigured(): 'smtp' | 'console' {
  return process.env.MAIL_TRANSPORT === 'smtp' && process.env.SMTP_HOST && process.env.MAIL_FROM ? 'smtp' : 'console';
}

export async function sendMail(m: Mail): Promise<{ ok: boolean; transport: 'smtp' | 'console' }> {
  const transport = mailConfigured();
  try {
    if (transport === 'console') {
      console.log(`[mail:console] to=${m.to} subject="${m.subject}"\n${m.text}\n`);
      return { ok: true, transport };
    }
    await smtp().sendMail({ from: process.env.MAIL_FROM, to: m.to, subject: m.subject, text: m.text, html: m.html });
    return { ok: true, transport };
  } catch (e) {
    // Never log the message body: it holds a one-time link.
    console.error(`[mail:${transport}] send failed to=${m.to.replace(/(.).*(@.*)/, '$1***$2')}: ${(e as Error).message}`);
    return { ok: false, transport };
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** One plain, phone-friendly layout for every email we send. */
export function layout(opts: { heading: string; lines: string[]; button?: { label: string; url: string }; footer?: string }): { text: string; html: string } {
  const text = [opts.heading, '', ...opts.lines, ...(opts.button ? ['', `${opts.button.label}: ${opts.button.url}`] : []), '', opts.footer ?? 'LeadBotCloud'].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif"><div style="max-width:480px;margin:0 auto;padding:24px"><div style="background:#fff;border-radius:16px;padding:28px"><p style="margin:0 0 4px;font-weight:800;color:#0f9d58">LeadBotCloud</p><h1 style="margin:0 0 16px;font-size:20px;color:#111">${esc(opts.heading)}</h1>${opts.lines.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#333">${esc(l)}</p>`).join('')}${opts.button ? `<p style="margin:20px 0"><a href="${esc(opts.button.url)}" style="display:inline-block;background:#0f9d58;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px">${esc(opts.button.label)}</a></p><p style="margin:0 0 12px;font-size:12px;color:#666;word-break:break-all">${esc(opts.button.url)}</p>` : ''}<p style="margin:16px 0 0;font-size:12px;color:#888">${esc(opts.footer ?? 'You received this because of an action on your LeadBotCloud account.')}</p></div></div></body></html>`;
  return { text, html };
}
