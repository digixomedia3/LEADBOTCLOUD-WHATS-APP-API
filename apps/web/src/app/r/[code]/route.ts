import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { LINK_CODE_RE, looksLikeBot, safeRedirectTarget } from '@lbc/shared/tracked-links';
import { limiter } from '@/lib/rate-store';
import { appDb } from '@/lib/tenant-db';
import { clientIdOf } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/** Wrong codes per address. A real code is 62^12 possibilities, so guessing is hopeless, but there is no reason to let anyone try. */
const wrong = limiter('linkwrong', 30, 60_000);
/** Clicks per address. Generous (a family can share a router), only stops a script from filling the table. */
const clicks = limiter('linkclick', 120, 60_000);

const HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
} as const;

const notFound = () => new NextResponse('This link is not available.', { status: 404, headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });

async function follow(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const who = clientIdOf(req);
  if (!LINK_CODE_RE.test(code)) { await wrong.check(`w:${who}`); return notFound(); }
  if ((await wrong.peek(`w:${who}`)) > 0) return new NextResponse('Too many attempts. Try again in a minute.', { status: 429, headers: { ...HEADERS, 'Retry-After': '60' } });
  // Robots (link previews, scanners, HEAD requests) are sent on but not counted. A person over the click limit is still sent on, just not counted again.
  const bot = looksLikeBot(req.headers.get('user-agent'), req.method) || (await clicks.check(`c:${who}`)) > 0;
  let url: string | null = null;
  try {
    const r = (await appDb.execute(sql`select public.follow_link(${code}, ${bot}) as url`)) as unknown as { url: string | null }[];
    url = r[0]?.url ?? null;
  } catch (e) {
    console.error('follow_link failed', (e as Error).message);
    return new NextResponse('Something went wrong. Please try again.', { status: 503, headers: HEADERS });
  }
  if (!url) { await wrong.check(`w:${who}`); return notFound(); }
  // Checked when the campaign was made and by the database, and once more here so nothing odd in storage can ever become a redirect.
  const dest = safeRedirectTarget(url);
  if (!dest) return notFound();
  return NextResponse.redirect(dest, { status: 302, headers: HEADERS });
}

export const GET = follow;
export const HEAD = follow;
