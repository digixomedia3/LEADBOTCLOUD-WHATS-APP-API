import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Public. Says which commit is live and when it was shipped, nothing else.
 * `lbc-deploy` writes apps/web/build-info.json into the archive (never into git). Only the two
 * expected fields are ever copied out of it, and only if they look right, so nothing else can leak.
 */
export async function GET() {
  let commit = 'unknown';
  let deployedAt: string | null = null;
  try {
    const info = JSON.parse(readFileSync(join(process.cwd(), 'build-info.json'), 'utf8')) as { commit?: unknown; deployedAt?: unknown };
    if (typeof info.commit === 'string' && /^[0-9a-f]{7,40}$/.test(info.commit)) commit = info.commit;
    if (typeof info.deployedAt === 'string' && !Number.isNaN(Date.parse(info.deployedAt))) deployedAt = info.deployedAt;
  } catch {
    // Not deployed by lbc-deploy (local dev): report "unknown".
  }
  return NextResponse.json({ commit, deployedAt }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
