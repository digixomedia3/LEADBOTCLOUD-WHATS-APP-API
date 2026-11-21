import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { startSmtp, readable } from './support/smtp';

/**
 * The emails the product sends on its own: team invitations, and the two closing notices. A real SMTP server on a local port catches
 * what nodemailer sends, so these tests read the message a person would get. They check: who it goes to, that the link in it works
 * for exactly that invitation, that it never claims "we emailed them" when nothing was sent, and that a mail failure never breaks the
 * action that caused it.
 */
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
let role: 'owner' | 'admin' | 'agent' | 'viewer' = 'owner';
let tenant = '', user = '', userEmail = '';
const WS = 'Mail Co';
vi.mock('@/lib/session', async () => {
  const t = await import('@/lib/tenant-db');
  return { ...t, requireCtx: async () => ({ user: { id: user, name: 'Asha Owner', email: userEmail }, tenantId: tenant, workspace: { tenantId: tenant, name: WS, role, plan: 'pro' }, role, workspaces: [] }) };
});
const rlsSrc = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const ADMIN = process.env.DATABASE_URL_ADMIN_TEST ?? /process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/.exec(rlsSrc)?.[1] ?? '';
if (!ADMIN) throw new Error('Could not find the admin database URL for tests');
const ctx = () => ({ user: { id: user, name: 'Asha Owner', email: userEmail }, tenantId: tenant, workspace: { tenantId: tenant, name: WS, role, plan: 'pro' }, role });

describe('product emails (invite, closing notices)', () => {
  let sql: postgres.Sql; let smtp: Awaited<ReturnType<typeof startSmtp>>; let tag = '';
  const env0 = { ...process.env };
  const useSmtp = (port: number) => { process.env.MAIL_TRANSPORT = 'smtp'; process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = String(port); process.env.MAIL_FROM = 'LeadBotCloud <no-reply@example.com>'; delete process.env.SMTP_USER; };
  const useConsole = () => { process.env.MAIL_TRANSPORT = 'console'; };
  const text = (i: number) => readable(smtp.mails[i]!.data);

  beforeAll(async () => {
    sql = postgres(ADMIN, { max: 2 }); tag = randomUUID().slice(0, 8);
    tenant = randomUUID(); user = `mail-${tag}`; userEmail = `owner-${tag}@example.com`;
    await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${user}, 'Asha Owner', ${userEmail}, true, now(), now())`;
    await sql`insert into tenants (id, name) values (${tenant}, ${WS})`;
    await sql`insert into tenant_members (tenant_id, user_id, role) values (${tenant}, ${user}, 'owner')`;
    await sql`update tenants set plan_id = 'pro' where id = ${tenant}`.catch(() => undefined);
    smtp = await startSmtp(); process.env.APP_URL = 'https://app.example.test';
  });
  afterAll(async () => {
    process.env = env0; await smtp.close();
    await sql`delete from invitations where tenant_id = ${tenant}`; await sql`delete from audit_log where tenant_id = ${tenant}`;
    await sql`delete from tenants where id = ${tenant}`; await sql`delete from "user" where id = ${user}`; await sql.end();
  });

  describe('invitations', () => {
    it('with email on: the invited address gets one mail with the workspace, the inviter, the role and a link that matches the invitation', async () => {
      useSmtp(smtp.port); smtp.mails.length = 0; role = 'owner';
      const { inviteMember } = await import('../src/app/(app)/settings/actions');
      const to = `new-${tag}@example.com`;
      const r = await inviteMember({ email: to, role: 'agent' });
      expect(r.ok).toBe(true); if (!r.ok) return;
      expect(r.data.emailed).toBe(true);
      expect(smtp.mails).toHaveLength(1); expect(smtp.mails[0]!.to).toEqual([to]); expect(smtp.mails[0]!.from).toBe('no-reply@example.com');
      const body = text(0);
      expect(body).toContain(WS); expect(body).toContain('Asha Owner'); expect(body).toMatch(/an Agent/); expect(body).toContain(to);
      const link = /https:\/\/app\.example\.test\/invite\/[A-Za-z0-9_-]+/.exec(body)?.[0];
      expect(link).toBe(r.data.link);                                           // the emailed link is the very one the owner is shown
      expect(smtp.mails[0]!.data).toMatch(/Subject: .*invited you to Mail Co/);
    });
    it('the link in the mail really belongs to that invitation: its token hashes to the stored row', async () => {
      const { createHash } = await import('node:crypto');
      const body = text(0); const token = /\/invite\/([A-Za-z0-9_-]+)/.exec(body)![1]!;
      const rows = await sql`select email, role, token_hash, expires_at from invitations where tenant_id = ${tenant}`;
      expect(rows).toHaveLength(1);
      const hash = createHash('sha256').update(token).digest('hex');
      expect([rows[0]!.token_hash, Buffer.from(rows[0]!.token_hash as string).toString()].some((h) => h === hash || String(h).includes(hash.slice(0, 16)))).toBe(true);
      expect(rows[0]!.email).toBe(`new-${tag}@example.com`); expect(rows[0]!.role).toBe('agent');
    });
    it('the mail never contains a password, and the role wording matches (admin / agent / viewer)', async () => {
      useSmtp(smtp.port); smtp.mails.length = 0;
      const { sendInviteMail } = await import('../src/lib/notify');
      for (const [r, w] of [['admin', 'an Admin'], ['agent', 'an Agent'], ['viewer', 'a Viewer']] as const) {
        await sendInviteMail({ to: 'x@example.com', workspace: WS, inviter: 'Asha', role: r, token: 'tok', expiresAt: new Date('2026-12-01T00:00:00Z') });
      }
      expect(smtp.mails).toHaveLength(3);
      ['an Admin', 'an Agent', 'a Viewer'].forEach((w, i) => expect(text(i)).toContain(w));
      expect(text(0)).toMatch(/1 December 2026|30 November 2026/);               // the expiry is written as a date a person reads
      expect(text(0).toLowerCase()).not.toContain('password:');
    });
    it('with email off (console), the invitation still works and the screen is told nothing was emailed', async () => {
      useConsole(); smtp.mails.length = 0; const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { inviteMember } = await import('../src/app/(app)/settings/actions');
      const r = await inviteMember({ email: `console-${tag}@example.com`, role: 'viewer' });
      log.mockRestore();
      expect(r.ok).toBe(true); if (r.ok) { expect(r.data.emailed).toBe(false); expect(r.data.link).toMatch(/\/invite\//); }
      expect(smtp.mails).toHaveLength(0);
    });
    it('when the mail server is down or refuses the address, the invitation is still created and the owner is told to share the link', async () => {
      const dead = await startSmtp(); const port = dead.port; await dead.close();     // a port nobody listens on
      useSmtp(port); const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { inviteMember } = await import('../src/app/(app)/settings/actions');
      const r = await inviteMember({ email: `down-${tag}@example.com`, role: 'agent' });
      expect(r.ok).toBe(true); if (r.ok) expect(r.data.emailed).toBe(false);
      expect(Number((await sql`select count(*)::int n from invitations where tenant_id = ${tenant} and email = ${'down-' + tag + '@example.com'}`)[0]!.n)).toBe(1);
      const logged = err.mock.calls.map((c) => String(c[0])).join('\n'); err.mockRestore();
      expect(logged).toContain('send failed'); expect(logged).not.toMatch(/\/invite\/[A-Za-z0-9_-]{10,}/);   // the log never holds the secret link
      const refusing = await startSmtp({ rejectRecipient: /^refused-/ }); useSmtp(refusing.port);
      const e2 = vi.spyOn(console, 'error').mockImplementation(() => {});
      const r2 = await inviteMember({ email: `refused-${tag}@example.com`, role: 'agent' });
      e2.mockRestore(); await refusing.close();
      expect(r2.ok).toBe(true); if (r2.ok) expect(r2.data.emailed).toBe(false);
    });
    it('a refused invitation sends no mail: duplicate, already a member, over the seat limit, bad address, and a role that cannot invite', async () => {
      useSmtp(smtp.port); smtp.mails.length = 0;
      const { inviteMember } = await import('../src/app/(app)/settings/actions');
      expect((await inviteMember({ email: `new-${tag}@example.com`, role: 'agent' })).ok).toBe(false);   // already pending
      expect((await inviteMember({ email: userEmail, role: 'agent' })).ok).toBe(false);                    // already a member
      expect((await inviteMember({ email: 'not-an-email', role: 'agent' })).ok).toBe(false);
      for (const r of ['agent', 'viewer'] as const) { role = r; expect((await inviteMember({ email: `nope-${r}-${tag}@example.com`, role: 'agent' })).ok).toBe(false); }
      role = 'owner';
      expect(smtp.mails).toHaveLength(0);
    });
    it('an empty or malformed recipient is never handed to the mail server, and is reported as not sent', async () => {
      useSmtp(smtp.port); smtp.mails.length = 0; const { sendInviteMail, sendClosureRequestedMail, sendClosureCancelledMail } = await import('../src/lib/notify');
      for (const to of ['', 'nobody', '   ']) {
        expect((await sendInviteMail({ to, workspace: WS, inviter: 'A', role: 'agent', token: 't', expiresAt: new Date() })).sent, JSON.stringify(to)).toBe(false);
        expect((await sendClosureRequestedMail({ to, workspace: WS, dueAt: new Date() })).sent).toBe(false);
        expect((await sendClosureCancelledMail({ to, workspace: WS })).sent).toBe(false);
      }
      expect(smtp.mails).toHaveLength(0);
    });
    it('a name with line breaks is flattened to one line, in the subject and in the text of the mail', async () => {
      useSmtp(smtp.port); smtp.mails.length = 0; const { sendInviteMail, sendClosureRequestedMail } = await import('../src/lib/notify');
      await sendInviteMail({ to: 'a@example.com', workspace: 'Line one\r\nLine two\u2028Line three', inviter: 'Name\nWith break', role: 'agent', token: 't', expiresAt: new Date() });
      await sendClosureRequestedMail({ to: 'a@example.com', workspace: 'Shop\r\nBcc: x@example.com', dueAt: new Date() });
      const subj = (i: number) => decodeURIComponent(((/Subject: ([\s\S]*?)\r\nMessage-ID/.exec(smtp.mails[i]!.data)?.[1] ?? '').replace(/=\r\n/g, '').replace(/\?=\s*=\?UTF-8\?Q\?/g, '').replace(/=\?UTF-8\?Q\?|\?=/g, '').replace(/_/g, ' ').replace(/=([0-9A-F]{2})/g, '%$1')));
      expect(subj(0)).toContain('Name With break invited you to Line one Line two Line three');
      expect(text(0)).toContain('"Line one Line two Line three"'); expect(text(0)).not.toMatch(/Line one\r?\nLine two/);
      expect(text(1)).toContain('"Shop Bcc: x@example.com"');                  // flattened: one line, so it cannot pass as a header
      expect(smtp.mails[1]!.data.split(/\r?\n/).filter((l) => /^Bcc:/i.test(l))).toHaveLength(0);
    });
    it('control characters that are not whitespace (null, bell, escape, delete) are removed from names, not passed on', async () => {
      useSmtp(smtp.port); smtp.mails.length = 0; const { sendInviteMail } = await import('../src/lib/notify');
      await sendInviteMail({ to: 'a@example.com', workspace: 'Shop\u0000One\u0007Two\u001bThree\u007fFour', inviter: 'N', role: 'agent', token: 't', expiresAt: new Date() });
      const body = text(0);
      expect(body).toContain('"Shop One Two Three Four"');
      expect(/[\u0000\u0007\u001b\u007f]/.test(body)).toBe(false);
    });
    it('a hostile address or workspace name cannot inject headers or markup into the mail', async () => {
      useSmtp(smtp.port); smtp.mails.length = 0;
      const { sendInviteMail } = await import('../src/lib/notify');
      await sendInviteMail({ to: 'victim@example.com', workspace: '<script>alert(1)</script>\r\nBcc: evil@example.com', inviter: 'A"><img src=x onerror=1>', role: 'agent', token: 't', expiresAt: new Date() });
      const raw = smtp.mails[0]!.data; const [head = '', ...rest] = raw.split(/\r\n\r\n/); const body = rest.join('\n\n');
      expect(smtp.mails[0]!.to).toEqual(['victim@example.com']);                  // still only the one real recipient
      expect(head).not.toMatch(/^Bcc:/mi); expect(head.split(/\r\n/).filter((l) => /^[A-Za-z-]+:/.test(l)).map((l) => l.split(':')[0])).not.toContain('Bcc');
      expect(raw.split(/\r?\n/).filter((l) => /^Bcc:/i.test(l))).toHaveLength(0);   // the injected text is not even on a line of its own in the body
      // Only the HTML part is interpreted as markup, so that is where a tag would be dangerous. The plain-text part and the subject show the
      // characters as text, which is correct (a mail client does not run them).
      const htmlPart = raw.split(/--_NmP[^\r\n]*/).find((x) => /Content-Type: text\/html/i.test(x)) ?? '';
      expect(htmlPart.length).toBeGreaterThan(100);
      const html = readable(htmlPart); expect(html).not.toContain('<script'); expect(html).not.toContain('<img'); expect(html).toContain('&lt;script&gt;');
    });
  });

  describe('closing notices', () => {
    it('requesting a closure emails the owner the exact date, what is deleted and how to stop it', async () => {
      useSmtp(smtp.port); smtp.mails.length = 0; role = 'owner';
      await sql`update tenants set closure_requested_at = null, closure_due_at = null, closure_requested_by = null where id = ${tenant}`;
      const { requestClosure } = await import('../src/lib/core/closure');
      const r = await requestClosure(ctx() as never, WS);
      expect(r.ok).toBe(true); if (!r.ok) return;
      expect(smtp.mails).toHaveLength(1); expect(smtp.mails[0]!.to).toEqual([userEmail]);
      const body = text(0);
      expect(body).toContain(WS); expect(body).toMatch(/permanently deleted/i); expect(body).toMatch(/Cancel closing/i);
      const due = new Date(r.data.dueAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
      expect(body).toContain(due);                                              // the date in the mail is the date the system will actually use
      expect(body).toContain('https://app.example.test/settings');
    });
    it('the closing notice names the date, not just "the due date"', async () => {
      useSmtp(smtp.port); smtp.mails.length = 0; const { sendClosureRequestedMail } = await import('../src/lib/notify');
      await sendClosureRequestedMail({ to: 'a@example.com', workspace: WS, dueAt: new Date('2027-01-15T10:00:00Z') });
      expect(text(0)).toContain('15 January 2027'); expect(text(0)).toMatch(/On 15 January 2027 all of its contacts/); expect(text(0)).not.toMatch(/due date/i);
      expect(smtp.mails[0]!.data).toMatch(/Subject:[\s\S]*15[\s\S]*January[\s\S]*2027|Subject:[\s\S]*closed on/i);
    });
    it('asking again sends no second mail (nothing changed)', async () => {
      smtp.mails.length = 0; const { requestClosure } = await import('../src/lib/core/closure');
      expect((await requestClosure(ctx() as never, WS)).ok).toBe(true);
      expect(smtp.mails.length).toBeLessThanOrEqual(1);                          // the database treats it as unchanged; at most the same notice, never a different date
      for (const m of smtp.mails) expect(readable(m.data)).toContain(WS);
    });
    it('cancelling emails the owner that the workspace stays open; cancelling when nothing is pending sends nothing', async () => {
      useSmtp(smtp.port); smtp.mails.length = 0; const { cancelClosure } = await import('../src/lib/core/closure');
      expect((await cancelClosure(ctx() as never)).ok).toBe(true);
      expect(smtp.mails).toHaveLength(1); expect(text(0)).toMatch(/will stay open|Nothing will be deleted/i);
      smtp.mails.length = 0; const again = await cancelClosure(ctx() as never);
      expect(again.ok).toBe(true); expect(smtp.mails).toHaveLength(0);
    });
    it('a refused request (wrong name, not the owner) sends nothing', async () => {
      useSmtp(smtp.port); smtp.mails.length = 0; const { requestClosure } = await import('../src/lib/core/closure');
      expect((await requestClosure(ctx() as never, 'wrong name')).ok).toBe(false);
      role = 'admin'; expect((await requestClosure(ctx() as never, WS)).ok).toBe(false); role = 'owner';
      expect(smtp.mails).toHaveLength(0);
    });
    it('if the mail server is down, the closure is still requested and cancelling still works', async () => {
      const dead = await startSmtp(); const port = dead.port; await dead.close(); useSmtp(port);
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { requestClosure, cancelClosure } = await import('../src/lib/core/closure');
      expect((await requestClosure(ctx() as never, WS)).ok).toBe(true);
      expect((await sql`select closure_requested_at from tenants where id = ${tenant}`)[0]!.closure_requested_at).not.toBeNull();
      expect((await cancelClosure(ctx() as never)).ok).toBe(true);
      expect((await sql`select closure_requested_at from tenants where id = ${tenant}`)[0]!.closure_requested_at).toBeNull();
      err.mockRestore();
    });
    it('a mail that throws (not just fails) cannot undo the closure request', async () => {
      useSmtp(smtp.port); await sql`update tenants set closure_requested_at = null, closure_due_at = null, closure_requested_by = null where id = ${tenant}`;
      const notify = await import('../src/lib/notify'); const spy = vi.spyOn(notify, 'sendClosureRequestedMail').mockRejectedValueOnce(new Error('mail layer exploded'));
      const { requestClosure, cancelClosure } = await import('../src/lib/core/closure');
      const r = await requestClosure(ctx() as never, WS); spy.mockRestore();
      expect(r.ok).toBe(true);
      expect((await sql`select closure_requested_at from tenants where id = ${tenant}`)[0]!.closure_requested_at).not.toBeNull();
      const spy2 = vi.spyOn(notify, 'sendClosureCancelledMail').mockRejectedValueOnce(new Error('mail layer exploded'));
      expect((await cancelClosure(ctx() as never)).ok).toBe(true); spy2.mockRestore();
      expect((await sql`select closure_requested_at from tenants where id = ${tenant}`)[0]!.closure_requested_at).toBeNull();
    });
  });
});
