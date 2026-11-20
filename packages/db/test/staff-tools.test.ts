import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { createDb } from '../src';
import { resetTwoFactor } from '../src/staff-tools';

const src = readFileSync(new URL('./rls.test.ts', import.meta.url), 'utf8');
const pick = (re: RegExp) => re.exec(src)![1]!;
const ADMIN_URL = process.env.DATABASE_URL_ADMIN_TEST ?? pick(/process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/);
const admin = createDb(ADMIN_URL, { max: 2 });
/** The staff tool takes a plain postgres connection, exactly what the command line gives it. */
const raw = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
const tag = randomUUID().slice(0, 8);
const A = `rs-${tag}-a`, B = `rs-${tag}-b`, C = `rs-${tag}-c`;
const email = (id: string) => `${id}@example.com`;
const u = admin.client.unsafe;
const count = async (q: string) => Number((await u(q))[0]!.n);

beforeAll(async () => {
  for (const id of [A, B, C]) await u(`insert into "user" (id, name, email, email_verified, created_at, updated_at, two_factor_enabled) values ('${id}', '${id}', '${email(id)}', true, now(), now(), ${id !== C})`);
  for (const id of [A, B]) await u(`insert into two_factor (id, user_id, secret, backup_codes, verified) values ('tf-${id}', '${id}', 'x', 'x', true)`);
  for (const [i, id] of [[1, A], [2, A], [3, B], [4, C]] as const) await u(`insert into "session" (id, user_id, token, expires_at, created_at, updated_at) values ('s-${tag}-${i}', '${id}', 'tok-${tag}-${i}', now() + interval '1 day', now(), now())`);
});
afterAll(async () => {
  await u(`delete from audit_log where entity_id like 'rs-${tag}%'`);
  await u(`delete from "user" where id like 'rs-${tag}%'`);
  const left = await count(`select count(*)::int n from "user" where id like 'rs-${tag}%'`);
  await admin.client.end(); await raw.end();
  if (left !== 0) throw new Error('staff-tools test left users behind');
});

describe('resetting two-step sign-in for locked-out staff', () => {
  it('clears their setup, turns the flag off and ends every sign-in of theirs', async () => {
    const r = await resetTwoFactor(raw, email(A));
    expect(r).toEqual({ found: true, hadTwoFactor: true, sessionsEnded: 2 });
    expect(await count(`select count(*)::int n from two_factor where user_id = '${A}'`)).toBe(0);
    expect((await u(`select two_factor_enabled from "user" where id = '${A}'`))[0]!.two_factor_enabled).toBe(false);
    expect(await count(`select count(*)::int n from "session" where user_id = '${A}'`)).toBe(0);
  });

  it('touches nobody else: another person keeps their setup, flag and sign-ins', async () => {
    expect(await count(`select count(*)::int n from two_factor where user_id = '${B}'`)).toBe(1);
    expect((await u(`select two_factor_enabled from "user" where id = '${B}'`))[0]!.two_factor_enabled).toBe(true);
    expect(await count(`select count(*)::int n from "session" where user_id = '${B}'`)).toBe(1);
    expect(await count(`select count(*)::int n from "session" where user_id = '${C}'`)).toBe(1);
  });

  it('writes who was reset to the audit log, with no secret in it', async () => {
    const [l] = await u(`select action, after from audit_log where entity_id = '${A}' and action = 'admin.two_factor_reset'`);
    expect(l!.after).toMatchObject({ email: email(A), hadTwoFactor: true, sessionsEnded: 2 });
    expect(JSON.stringify(l!.after)).not.toMatch(/secret|backup|token/i);
  });

  it('matches the email without regard to case or stray spaces', async () => {
    const r = await resetTwoFactor(raw, `  ${email(B).toUpperCase()}  `);
    expect(r).toMatchObject({ found: true, hadTwoFactor: true, sessionsEnded: 1 });
    expect(await count(`select count(*)::int n from two_factor where user_id = '${B}'`)).toBe(0);
  });

  it('is safe to run again: nothing to clear, still signs out, reports that honestly', async () => {
    const r = await resetTwoFactor(raw, email(A)); expect(r).toEqual({ found: true, hadTwoFactor: false, sessionsEnded: 0 });
    const c = await resetTwoFactor(raw, email(C)); expect(c).toEqual({ found: true, hadTwoFactor: false, sessionsEnded: 1 });
  });

  it('says so for an unknown email and changes nothing', async () => {
    const before = await count(`select count(*)::int n from audit_log where action = 'admin.two_factor_reset'`);
    expect(await resetTwoFactor(raw, 'nobody-here@example.com')).toEqual({ found: false, hadTwoFactor: false, sessionsEnded: 0 });
    expect(await count(`select count(*)::int n from audit_log where action = 'admin.two_factor_reset'`)).toBe(before);
  });

  it('is all or nothing: if the audit write fails the setup is NOT cleared and nobody is signed out', async () => {
    await u(`insert into "session" (id, user_id, token, expires_at, created_at, updated_at) values ('s-${tag}-9', '${A}', 'tok-${tag}-9', now() + interval '1 day', now(), now())`);
    await u(`insert into two_factor (id, user_id, secret, backup_codes, verified) values ('tf-${A}-2', '${A}', 'x', 'x', true)`);
    await u(`update "user" set two_factor_enabled = true where id = '${A}'`);
    // A trigger that refuses only this one kind of audit entry, so the failure is real and happens AFTER the other changes were made inside the transaction.
    await u(`create or replace function public.rs_refuse() returns trigger language plpgsql as $$ begin if new.action = 'admin.two_factor_reset' and new.entity_id = '${A}' then raise exception 'audit refused'; end if; return new; end $$`);
    await u(`create trigger rs_refuse_trg before insert on audit_log for each row execute function public.rs_refuse()`);
    try { await expect(resetTwoFactor(raw, email(A))).rejects.toThrow(/audit refused/); }
    finally { await u(`drop trigger rs_refuse_trg on audit_log`); await u(`drop function public.rs_refuse()`); }
    expect(await count(`select count(*)::int n from two_factor where user_id = '${A}'`)).toBe(1);
    expect((await u(`select two_factor_enabled from "user" where id = '${A}'`))[0]!.two_factor_enabled).toBe(true);
    expect(await count(`select count(*)::int n from "session" where user_id = '${A}'`)).toBe(1);
  });
});
