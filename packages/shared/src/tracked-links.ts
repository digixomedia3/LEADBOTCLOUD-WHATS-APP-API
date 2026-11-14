/**
 * Tracked links: rules that don't need a database. Plain code with no Node-only imports, so the browser panel can use it too.
 */

/** Where a tracked button must point. https only, a real host, no embedded passwords, no spaces, not our own redirector (no loops). */
export function checkLinkDestination(raw: string, appUrl?: string): { ok: true; url: string } | { ok: false; error: string } {
  const s = (raw ?? '').trim();
  if (!s) return { ok: false, error: 'Enter the website address the button should open.' };
  if (s.length > 2000) return { ok: false, error: 'That address is too long.' };
  if (/\s/.test(s)) return { ok: false, error: 'The address cannot contain spaces.' };
  let u: URL;
  try { u = new URL(s); } catch { return { ok: false, error: 'Enter a full website address starting with https://' }; }
  if (u.protocol !== 'https:') return { ok: false, error: 'The address must start with https://' };
  if (u.username || u.password) return { ok: false, error: 'The address cannot contain a username or password.' };
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.startsWith('[')) return { ok: false, error: 'Use your own website address (a name like shop.example.com, not a number or a local address).' };
  if (appUrl) {
    try { if (new URL(appUrl).hostname.toLowerCase() === host) return { ok: false, error: 'The button cannot point back to LeadBotCloud.' }; } catch { /* ignore a bad APP_URL here */ }
  }
  if (/\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|cutt\.ly)$/.test(host)) return { ok: false, error: 'Link shorteners are not allowed. Use your own address.' };
  return { ok: true, url: u.toString() };
}

/** The address a tracked website button is built on. Meta fixes it when the template is approved, so it must be the permanent app address. */
export function trackedButtonValue(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, '')}/r/{{1}}`;
}

/** True only for exactly our tracked button, so a tenant's own `https://theirs.com/{{1}}` button is never filled with our code. */
export function isTrackedButtonValue(value: string | undefined | null, appUrl: string): boolean {
  return !!value && value.trim() === trackedButtonValue(appUrl);
}

/** A temporary address (local, tunnel) cannot be used for templates: the link would die the day the address changes. */
export function isTemporaryAppUrl(appUrl: string): boolean {
  try {
    const h = new URL(appUrl).hostname.toLowerCase();
    return h === 'localhost' || h.endsWith('.local') || /^\d+\.\d+\.\d+\.\d+$/.test(h) || /(^|\.)(trycloudflare\.com|ngrok\.io|ngrok-free\.app|loca\.lt|localtunnel\.me)$/.test(h);
  } catch { return true; }
}

const BOT = /bot\b|crawl|spider|slurp|preview|fetch|facebookexternalhit|facebot|whatsapp\/|telegrambot|twitterbot|linkedinbot|slackbot|discordbot|skypeuripreview|google-|googlebot|bingpreview|headless|phantomjs|python-requests|python-urllib|aiohttp|curl\/|wget\/|go-http-client|okhttp\/.*(?:monitor)|java\/|libwww|apache-httpclient|node-fetch|axios\/|postman|insomnia|uptime|monitor|scanner|safelinks|proofpoint|mimecast|barracuda|virustotal/i;
/**
 * Does this look like a robot (link-preview fetcher, security scanner, script) rather than a person?
 * Robots are still sent on to the destination but are not counted as clicks. Empty means unknown, which is treated as a robot.
 * HEAD requests never count: browsers do not use them to open a page.
 */
export function looksLikeBot(userAgent: string | null | undefined, method = 'GET'): boolean {
  if (method.toUpperCase() !== 'GET') return true;
  const ua = (userAgent ?? '').trim();
  if (ua.length < 12) return true;
  return BOT.test(ua);
}

export const LINK_CODE_RE = /^[A-Za-z0-9]{12}$/;

/**
 * The last check before a person is redirected. The address was validated when the campaign was made and the database refuses bad ones,
 * but a redirect is the one place a mistake becomes an attack, so it is checked once more: https only, a normal host, nothing embedded.
 * Returns the address to use, or null to show "not available".
 */
export function safeRedirectTarget(stored: string | null | undefined): string | null {
  if (!stored) return null;
  let u: URL;
  try { u = new URL(stored); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return null;
  return u.toString();
}
