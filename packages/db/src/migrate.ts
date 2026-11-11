import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

/**
 * Tiny append-only migrator. Runs every drizzle/*.sql file once, in filename order,
 * as the OWNER role (DATABASE_URL_MIGRATE). Applied files are recorded in
 * public._lbc_migrations and are never re-run or rewritten (AGENTS.md rule 8).
 */
const url = process.env.DATABASE_URL_MIGRATE;
if (!url) throw new Error('DATABASE_URL_MIGRATE is required');

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
const sqlc = postgres(url, { max: 1, onnotice: () => {} });

await sqlc`create table if not exists public._lbc_migrations (name text primary key, applied_at timestamptz not null default now())`;
const done = new Set((await sqlc`select name from public._lbc_migrations`).map((r) => r.name as string));

for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
  if (done.has(f)) continue;
  const body = readFileSync(join(dir, f), 'utf8').replaceAll('--> statement-breakpoint', '');
  await sqlc.begin(async (tx) => {
    await tx.unsafe(body);
    await tx`insert into public._lbc_migrations (name) values (${f})`;
  });
  console.log(`applied ${f}`);
}
await sqlc.end();
console.log('migrations up to date');
