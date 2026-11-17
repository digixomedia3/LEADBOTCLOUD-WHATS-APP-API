import postgres from 'postgres';

/**
 * Add or remove platform staff. Run on the server by whoever holds the database owner credentials; there is deliberately no way to do this from the app.
 *   pnpm --filter @lbc/db admin:add someone@company.com
 *   pnpm --filter @lbc/db admin:remove someone@company.com
 * The person must already have an account. Both actions are written to the audit log.
 */
const [, , action, rawEmail] = process.argv;
const url = process.env.DATABASE_URL_MIGRATE;
if (!url) throw new Error('DATABASE_URL_MIGRATE is required');
if ((action !== 'add' && action !== 'remove') || !rawEmail) { console.error('usage: platform-admin <add|remove> <email>'); process.exit(2); }
const email = rawEmail.trim().toLowerCase();
const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  const [u] = await sql`select id from "user" where lower(email) = ${email}`;
  if (!u) { console.error(`No account with the email ${email}. They need to sign up first.`); process.exit(1); }
  if (action === 'add') {
    const r = await sql`insert into platform_admins (user_id, added_by) values (${u.id}, 'cli') on conflict do nothing returning user_id`;
    await sql`insert into audit_log (tenant_id, actor_type, action, entity, entity_id, after) values (null, 'system', 'admin.staff_added', 'user', ${u.id}, ${sql.json({ email })})`;
    console.log(r.length ? `${email} is now platform staff.` : `${email} was already platform staff.`);
  } else {
    const r = await sql`delete from platform_admins where user_id = ${u.id} returning user_id`;
    await sql`insert into audit_log (tenant_id, actor_type, action, entity, entity_id, after) values (null, 'system', 'admin.staff_removed', 'user', ${u.id}, ${sql.json({ email })})`;
    console.log(r.length ? `${email} is no longer platform staff.` : `${email} was not platform staff.`);
  }
} finally { await sql.end(); }
