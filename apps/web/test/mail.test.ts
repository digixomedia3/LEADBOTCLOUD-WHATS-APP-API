import { afterEach, describe, expect, it, vi } from 'vitest';

// server-only throws outside Next; the mailer is plain server code, so stub the guard for tests.
vi.mock('server-only', () => ({}));

const send = vi.fn();
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: send }) } }));

const ENV = ['MAIL_TRANSPORT', 'SMTP_HOST', 'MAIL_FROM'];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
afterEach(() => { send.mockReset(); vi.restoreAllMocks(); vi.resetModules(); for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const load = async () => (await import('../src/lib/mail'));

describe('mailer', () => {
  it('defaults to the console transport and prints the message, never touching SMTP', async () => {
    delete process.env.MAIL_TRANSPORT;
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { sendMail, mailConfigured } = await load();
    expect(mailConfigured()).toBe('console');
    expect(await sendMail({ to: 'a@b.co', subject: 'Hi', text: 'body' })).toEqual({ ok: true, transport: 'console' });
    expect(log).toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
  it('smtp needs host AND from; one without the other stays on console instead of failing', async () => {
    process.env.MAIL_TRANSPORT = 'smtp'; process.env.SMTP_HOST = 'smtp.example.org'; delete process.env.MAIL_FROM;
    expect((await load()).mailConfigured()).toBe('console');
  });
  it('sends through smtp when configured', async () => {
    process.env.MAIL_TRANSPORT = 'smtp'; process.env.SMTP_HOST = 'smtp.example.org'; process.env.MAIL_FROM = 'LeadBotCloud <no-reply@example.org>';
    send.mockResolvedValue({});
    const { sendMail } = await load();
    expect(await sendMail({ to: 'a@b.co', subject: 'S', text: 'T', html: '<p>T</p>' })).toEqual({ ok: true, transport: 'smtp' });
    expect(send).toHaveBeenCalledWith({ from: 'LeadBotCloud <no-reply@example.org>', to: 'a@b.co', subject: 'S', text: 'T', html: '<p>T</p>' });
  });
  it('a failing send returns ok:false, does not throw, and the log has neither the link nor the full address', async () => {
    process.env.MAIL_TRANSPORT = 'smtp'; process.env.SMTP_HOST = 'smtp.example.org'; process.env.MAIL_FROM = 'x@example.org';
    send.mockRejectedValue(new Error('connection refused'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { sendMail } = await load();
    const r = await sendMail({ to: 'customer@example.com', subject: 'Reset', text: 'https://app/reset?token=SECRET123' });
    expect(r.ok).toBe(false);
    const logged = err.mock.calls.flat().join(' ');
    expect(logged).not.toContain('SECRET123'); expect(logged).not.toContain('customer@'); expect(logged).toContain('c***@example.com');
  });
  it('the layout escapes anything that could be markup, and includes the link as text and as a button', async () => {
    const { layout } = await load();
    const m = layout({ heading: 'Hi <b>x</b>', lines: ['a & b'], button: { label: 'Go', url: 'https://x.co/?a=1&b="2"' } });
    expect(m.html).not.toContain('<b>x</b>'); expect(m.html).toContain('&lt;b&gt;x&lt;/b&gt;'); expect(m.html).toContain('a &amp; b');
    expect(m.html).toContain('href="https://x.co/?a=1&amp;b=&quot;2&quot;"');
    expect(m.text).toContain('Go: https://x.co/?a=1&b="2"');
  });
});
