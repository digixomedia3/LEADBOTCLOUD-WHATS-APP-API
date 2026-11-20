import type postgres from 'postgres';

/**
 * Server-side staff tools, kept apart from the command line so they can be tested.
 * resetTwoFactor: a staff member who lost their phone and backup codes gets locked out of the admin panel. Someone with the database owner credentials (never the
 * app) clears their two-step setup and signs them out everywhere; they then set it up again from Settings > Security. Written to the audit log.
 */
export type Sql = postgres.Sql;
export interface ResetResult { found: boolean; hadTwoFactor: boolean; sessionsEnded: number }

export async function resetTwoFactor(sql: Sql, rawEmail: string): Promise<ResetResult> {
  const email = rawEmail.trim().toLowerCase();
  return sql.begin(async (tx) => {
    const [u] = await tx`select id, two_factor_enabled from "user" where lower(email) = ${email} for update`;
    if (!u) return { found: false, hadTwoFactor: false, sessionsEnded: 0 };
    const gone = await tx`delete from two_factor where user_id = ${u.id} returning id`;
    await tx`update "user" set two_factor_enabled = false, updated_at = now() where id = ${u.id}`;
    // Everyone signed in as this person is signed out, so a stolen session cannot outlive the reset.
    const ended = await tx`delete from "session" where user_id = ${u.id} returning id`;
    await tx`insert into audit_log (tenant_id, actor_type, action, entity, entity_id, after) values (null, 'system', 'admin.two_factor_reset', 'user', ${u.id}, ${tx.json({ email, hadTwoFactor: gone.length > 0 || u.two_factor_enabled === true, sessionsEnded: ended.length })})`;
    return { found: true, hadTwoFactor: gone.length > 0 || u.two_factor_enabled === true, sessionsEnded: ended.length };
  });
}
