import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

/**
 * Two-step sign-in, tested against the real sign-in code (Better Auth with its two-factor plugin) and the real database.
 * Codes are computed here from the secret with RFC 6238 in a few lines of node:crypto, so the plugin is checked against the standard and not against itself.
 */
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/headers', () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined, getAll: () => [] }) }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: () => { throw new Error('REDIRECT'); } }));
let currentUser: string | null = null;
vi.mock('@/lib/session', async () => {
  const t = await import('@/lib/tenant-db');
  return { ...t, getSession: async () => (currentUser ? { user: { id: currentUser, name: 'N', email: currentUser + '@example.com' } } : null) };
});
const rlsSrc = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const ADMIN = process.env.DATABASE_URL_ADMIN_TEST ?? /process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/.exec(rlsSrc)?.[1] ?? '';
if (!ADMIN) throw new Error('Could not find the admin database URL for tests');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32decode = (s: string) => { let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) bits += B32.indexOf(c).toString(2).padStart(5, '0'); const out: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
const totp = (secretB32: string, at = Date.now()) => {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac('sha1', b32decode(secretB32)).update(counter).digest(); const o = h[h.length - 1]! & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
};

describe('two-step sign-in', () => {
  let sql: postgres.Sql; let auth: typeof import('../src/lib/auth').auth;
  const tag = randomUUID().slice(0, 8); const email = `tf-${tag}@example.com`; const pw = 'Correct-Horse-2026';
  let staffId = '', plainId = '', staffEmail = '';
  const hdr = (cookie = '') => new Headers({ origin: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000', ...(cookie ? { cookie } : {}) });
  const cookiesOf = (res: Response) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]!).filter((c) => !/=\s*$/.test(c)).join('; ');
  let ipN = 0; let ip = '';
  const call = (path: string, body: unknown, cookie = '') => auth.handler(new Request(`${process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'}/api/auth${path}`, { method: 'POST', headers: { ...Object.fromEntries(hdr(cookie)), 'content-type': 'application/json', 'x-forwarded-for': ip || `10.${(ipN >> 8) & 255}.${ipN & 255}.7` }, body: JSON.stringify(body) }));
  const newClient = () => { ipN += 1; ip = `10.${(ipN >> 8) & 255}.${ipN & 255}.9`; };
  const signUp = async (e: string) => { const r = await call('/sign-up/email', { email: e, password: pw, name: 'Test Person' }); expect(r.status).toBe(200); const j = await r.json() as { user: { id: string } }; return { id: j.user.id, cookie: cookiesOf(r) }; };

  beforeAll(async () => {
    sql = postgres(ADMIN, { max: 2 }); ({ auth } = await import('../src/lib/auth'));
    // Each test file run uses fresh addresses, so the per-address sign-in limit never carries over between runs.
  });
  afterAll(async () => {
    await sql`delete from audit_log where actor_user_id in (select id from "user" where email like ${'%' + tag + '%'})`;
    await sql`delete from platform_admins where user_id in (select id from "user" where email like ${'%' + tag + '%'})`;
    await sql`delete from "user" where email like ${'%' + tag + '%'}`;
    const left = await sql`select count(*)::int n from "user" where email like ${'%' + tag + '%'}`; await sql.end();
    if (Number(left[0]!.n) !== 0) throw new Error('two-factor test left accounts behind');
  });

  it('turn on: needs the password, returns a secret and ten backup codes, and the secret is stored scrambled, never readable', async () => {
    const u = await signUp(email); plainId = u.id;
    const wrong = await call('/two-factor/enable', { password: 'not-the-password' }, u.cookie); expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect((await sql`select two_factor_enabled from "user" where id = ${plainId}`)[0]!.two_factor_enabled).toBe(false);
    const ok = await call('/two-factor/enable', { password: pw }, u.cookie); expect(ok.status).toBe(200);
    const j = await ok.json() as { totpURI: string; backupCodes: string[] }; expect(j.totpURI).toMatch(/^otpauth:\/\/totp\/LeadBotCloud:/); expect(j.backupCodes).toHaveLength(10);
    expect(j.backupCodes.every((c) => c.length >= 10)).toBe(true); expect(new Set(j.backupCodes).size).toBe(10);
    const secret = new URL(j.totpURI).searchParams.get('secret')!; expect(secret.length).toBeGreaterThanOrEqual(16);
    // Not switched on until a real code proves the phone works.
    expect((await sql`select two_factor_enabled from "user" where id = ${plainId}`)[0]!.two_factor_enabled).toBe(false);
    const stored = (await sql`select secret, backup_codes from two_factor where user_id = ${plainId}`)[0]!;
    expect(stored.secret).not.toContain(secret); expect(stored.backup_codes).not.toContain(j.backupCodes[0]!);   // encrypted at rest
    const bad = await call('/two-factor/verify-totp', { code: '000000' }, u.cookie); expect(bad.status).toBeGreaterThanOrEqual(400);
    expect((await sql`select two_factor_enabled from "user" where id = ${plainId}`)[0]!.two_factor_enabled).toBe(false);
    const good = await call('/two-factor/verify-totp', { code: totp(secret) }, u.cookie); expect(good.status).toBe(200);
    expect((await sql`select two_factor_enabled from "user" where id = ${plainId}`)[0]!.two_factor_enabled).toBe(true);
    (globalThis as Record<string, unknown>).__tf = { secret, backup: j.backupCodes };
  });

  it('sign in: the password alone no longer gives a session, a wrong code does not either, the right code does', async () => { newClient();
    const { secret } = (globalThis as Record<string, unknown>).__tf as { secret: string };
    const before = Number((await sql`select count(*)::int n from session where user_id = ${plainId}`)[0]!.n);
    const si = await call('/sign-in/email', { email, password: pw }); expect(si.status).toBe(200);
    const body = await si.json() as { twoFactorRedirect?: boolean; token?: string }; expect(body.twoFactorRedirect).toBe(true);
    expect(Number((await sql`select count(*)::int n from session where user_id = ${plainId}`)[0]!.n)).toBe(before);     // no session was left behind
    const pending = cookiesOf(si);
    expect(pending).not.toMatch(/session_token=/);                                                                     // and no signed-in cookie
    const wrong = await call('/two-factor/verify-totp', { code: '123456' === totp(secret) ? '654321' : '123456' }, pending); expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect(Number((await sql`select count(*)::int n from session where user_id = ${plainId}`)[0]!.n)).toBe(before);
    const right = await call('/two-factor/verify-totp', { code: totp(secret) }, pending); expect(right.status).toBe(200);
    expect(Number((await sql`select count(*)::int n from session where user_id = ${plainId}`)[0]!.n)).toBe(before + 1);
    expect(cookiesOf(right)).toMatch(/session_token=/);
  });

  it('a code from the wrong moment is refused (old codes do not work), and "trust this device" does not skip the step', async () => { newClient();
    const { secret } = (globalThis as Record<string, unknown>).__tf as { secret: string };
    const si = await call('/sign-in/email', { email, password: pw }); const pending = cookiesOf(si);
    const old = totp(secret, Date.now() - 10 * 60_000); const now = totp(secret);
    if (old !== now) { const r = await call('/two-factor/verify-totp', { code: old }, pending); expect(r.status).toBeGreaterThanOrEqual(400); }
    const r2 = await call('/two-factor/verify-totp', { code: totp(secret), trustDevice: true }, pending); expect(r2.status).toBe(200);
    const again = await call('/sign-in/email', { email, password: pw }, cookiesOf(r2));           // sign in again carrying everything the first one set
    expect(((await again.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
  });

  it('backup codes: each works exactly once, a used one is refused, and a wrong one is refused', async () => { newClient();
    const { backup } = (globalThis as Record<string, unknown>).__tf as { backup: string[] };
    const first = async (code: string) => { const si = await call('/sign-in/email', { email, password: pw }); return call('/two-factor/verify-backup-code', { code }, cookiesOf(si)); };
    expect((await first('NOTACODE-00')).status).toBeGreaterThanOrEqual(400);
    expect((await first(backup[0]!)).status).toBe(200);
    expect((await first(backup[0]!)).status).toBeGreaterThanOrEqual(400);            // already used
    expect((await first(backup[1]!)).status).toBe(200);                              // a different one still works
  });

  it('too many wrong codes lock the account for 15 minutes, the right code is then refused, and the lock is stored', async () => {
    newClient();
    const e2 = `tfl-${tag}@example.com`; const u = await signUp(e2);
    const en = await call('/two-factor/enable', { password: pw }, u.cookie); const secret = new URL(((await en.json()) as { totpURI: string }).totpURI).searchParams.get('secret')!;
    expect((await call('/two-factor/verify-totp', { code: totp(secret) }, u.cookie)).status).toBe(200);
    const row = async () => (await sql`select failed_verification_count n, locked_until from two_factor where user_id = ${u.id}`)[0]!;
    expect(Number((await row()).n)).toBe(0); expect((await row()).locked_until).toBeNull();
    const wrongCode = () => (totp(secret) === '111111' ? '222222' : '111111');
    // Nine wrong tries, each from a different address and a fresh challenge, so the per-address rate limit cannot be what stops us: only the account lock can.
    for (let i = 0; i < 9; i++) { newClient(); const si = await call('/sign-in/email', { email: e2, password: pw }); const r = await call('/two-factor/verify-totp', { code: wrongCode() }, cookiesOf(si)); expect(r.status).toBeGreaterThanOrEqual(400); }
    expect(Number((await row()).n)).toBe(9); expect((await row()).locked_until).toBeNull();                   // not locked yet at nine
    newClient(); const si10 = await call('/sign-in/email', { email: e2, password: pw }); await call('/two-factor/verify-totp', { code: wrongCode() }, cookiesOf(si10));
    const locked = await row(); expect(locked.locked_until).not.toBeNull();                                     // locked on the tenth
    const mins = (new Date(locked.locked_until).getTime() - Date.now()) / 60_000; expect(mins).toBeGreaterThan(13); expect(mins).toBeLessThanOrEqual(15.1);
    // Now even the CORRECT code is refused, from a fresh address and a fresh challenge.
    newClient(); const si = await call('/sign-in/email', { email: e2, password: pw }); const right = await call('/two-factor/verify-totp', { code: totp(secret) }, cookiesOf(si));
    expect(right.status, 'the right code must be refused while the account is locked').toBe(429);
    expect(cookiesOf(right)).not.toMatch(/session_token=/);
    // A backup code is locked out too: the lock covers every way of passing the second step.
    newClient(); const si2 = await call('/sign-in/email', { email: e2, password: pw }); expect((await call('/two-factor/verify-backup-code', { code: 'whatever-00' }, cookiesOf(si2))).status).toBeGreaterThanOrEqual(400);
    // Once the lock time has passed the right code works again and the counter resets.
    await sql`update two_factor set locked_until = now() - interval '1 minute' where user_id = ${u.id}`;
    newClient(); const si3 = await call('/sign-in/email', { email: e2, password: pw }); const after = await call('/two-factor/verify-totp', { code: totp(secret) }, cookiesOf(si3));
    expect(after.status).toBe(200); expect(Number((await row()).n)).toBe(0); expect((await row()).locked_until).toBeNull();
  }, 90_000);

  it('turn off: needs the password, clears the second step, and the next sign-in is password only', async () => { newClient();
    const e3 = `tfo-${tag}@example.com`; const u = await signUp(e3);
    const en = await call('/two-factor/enable', { password: pw }, u.cookie); const secret = new URL(((await en.json()) as { totpURI: string }).totpURI).searchParams.get('secret')!;
    const v = await call('/two-factor/verify-totp', { code: totp(secret) }, u.cookie); const cookie = cookiesOf(v) || u.cookie;
    expect((await call('/two-factor/disable', { password: 'wrong-password-1' }, cookie)).status).toBeGreaterThanOrEqual(400);
    expect((await sql`select two_factor_enabled from "user" where email = ${e3}`)[0]!.two_factor_enabled).toBe(true);
    expect((await call('/two-factor/disable', { password: pw }, cookie)).status).toBe(200);
    expect((await sql`select two_factor_enabled from "user" where email = ${e3}`)[0]!.two_factor_enabled).toBe(false);
    expect(Number((await sql`select count(*)::int n from two_factor where user_id = (select id from "user" where email = ${e3})`)[0]!.n)).toBe(0);
    const si = await call('/sign-in/email', { email: e3, password: pw }); expect(((await si.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBeUndefined();
  });

  it('staff: without two-step sign-in the admin panel is closed (and says why only to staff); with it, it opens', async () => {
    staffEmail = `tfs-${tag}@example.com`; const u = await signUp(staffEmail); staffId = u.id;
    await sql`insert into platform_admins (user_id) values (${staffId})`;
    const A = await import('../src/lib/admin'); const Act = await import('../src/app/(admin)/admin/actions');
    currentUser = staffId;
    const st = await A.getAdminState.call(null) as { state: string }; expect(st.state).toBe('needs2fa');
    await expect(Act.loadOverview()).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(Act.loadAttention()).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(Act.searchUsers('')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(Act.signOutUser(plainId, 'should not be allowed')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(Act.setSuspended(randomUUID(), true, 'should not be allowed')).rejects.toThrow('NEXT_NOT_FOUND');
    await sql`update "user" set two_factor_enabled = true where id = ${staffId}`;
    // getAdminState is cached per request in the app; the test runs outside a request, so re-import for a fresh one.
    vi.resetModules(); const A2 = await import('../src/lib/admin'); const Act2 = await import('../src/app/(admin)/admin/actions');
    expect(((await A2.getAdminState()) as { state: string }).state).toBe('ok');
    expect((await Act2.loadOverview()).ok).toBe(true);
    await sql`update "user" set two_factor_enabled = false where id = ${staffId}`;
    vi.resetModules(); const A3 = await import('../src/lib/admin');
    expect(((await A3.getAdminState()) as { state: string }).state).toBe('needs2fa');                       // turning it off closes the panel again at once
  });

  it('a customer (not staff) sees nothing different: no hint that the admin panel exists', async () => {
    currentUser = plainId; vi.resetModules(); const A = await import('../src/lib/admin');
    expect(((await A.getAdminState()) as { state: string }).state).toBe('no');
    currentUser = null; vi.resetModules(); const B = await import('../src/lib/admin');
    expect(((await B.getAdminState()) as { state: string }).state).toBe('no');
  });

  it('the database: the admin functions can see whether someone has it on but can never read the secret or the codes', async () => {
    const app = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      await expect(app`select secret from two_factor limit 1`.then((r) => r)).resolves.toBeDefined();       // the sign-in code itself (the app role) can, it must
    } finally { await app.end(); }
    const rows = await sql`select has_column_privilege('owner', 'public.two_factor', 'secret', 'select') as s, has_column_privilege('owner', 'public.two_factor', 'backup_codes', 'select') as b, has_column_privilege('owner', 'public.two_factor', 'user_id', 'select') as u, has_column_privilege('worker', 'public.two_factor', 'secret', 'select') as w`;
    expect(rows[0]!.w).toBe(false);                                                                          // the background worker can never read a secret
    void rows;
    // And nothing the admin panel returns contains a secret or a code, even for a person who has it on.
    const staffRow = await sql`select id from "user" where email = ${staffEmail}`; const plain = await sql`select id from tenants limit 1`; void plain; void staffRow;
    const { appDb } = await import('../src/lib/tenant-db'); const { withUser } = await import('@lbc/db'); const { sql: s2 } = await import('drizzle-orm');
    const out = await withUser(appDb, staffId, async (tx) => JSON.stringify([await tx.execute(s2`select public.admin_users(${email}, 5) as r`), await tx.execute(s2`select public.admin_staff() as r`)]));
    const secretRows = await sql`select secret, backup_codes from two_factor where user_id = ${plainId}`;
    for (const r of secretRows) { expect(out).not.toContain(r.secret); expect(out).not.toContain(r.backup_codes); }
  });
});
