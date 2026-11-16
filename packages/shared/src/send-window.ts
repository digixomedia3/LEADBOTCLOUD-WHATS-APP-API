/**
 * Quiet hours and send speed. Pure functions: no clock reads, no database, so every rule is testable.
 *
 * Quiet hours protect the customer's night and the business's name: promotional messages wait until morning.
 * Only promotional ("marketing") messages are held. Replies and updates a customer expects are never delayed.
 */

export interface QuietHours { enabled: boolean; startHour: number; endHour: number; timezone: string }
export const DEFAULT_QUIET: QuietHours = { enabled: true, startHour: 21, endHour: 9, timezone: 'Asia/Kolkata' };

const isHour = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 23;

/** Checks what a person typed. Returns a plain-words problem, or null when fine. */
export function checkQuietHours(q: QuietHours): string | null {
  if (!isHour(q.startHour) || !isHour(q.endHour)) return 'Choose hours between 12 am and 11 pm.';
  if (q.enabled && q.startHour === q.endHour) return 'Quiet hours cannot start and end at the same time. Turn them off instead.';
  try { new Intl.DateTimeFormat('en-US', { timeZone: q.timezone }); } catch { return 'That time zone is not recognised.'; }
  // A window longer than 16 hours would leave almost no time to send, which is never what someone means.
  const len = q.startHour > q.endHour ? 24 - q.startHour + q.endHour : q.endHour - q.startHour;
  if (q.enabled && len > 16) return 'Quiet hours can be 16 hours at most, or no promotions would ever go out.';
  return null;
}

/** The wall-clock hour and minute in a time zone at a moment. */
export function localHourMinute(at: Date, timeZone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  return { hour: Number(parts.find((p) => p.type === 'hour')!.value) % 24, minute: Number(parts.find((p) => p.type === 'minute')!.value) };
}

export function isQuiet(at: Date, q: QuietHours): boolean {
  if (!q.enabled || checkQuietHours(q)) return false;   // a broken setting never blocks sending silently
  const { hour } = localHourMinute(at, q.timezone);
  return q.startHour > q.endHour ? hour >= q.startHour || hour < q.endHour : hour >= q.startHour && hour < q.endHour;
}

/** The first moment a promotional message may go out: now if it is allowed, otherwise the minute quiet hours end. */
export function nextAllowed(at: Date, q: QuietHours): Date {
  if (!isQuiet(at, q)) return at;
  let t = new Date(Math.floor(at.getTime() / 60_000) * 60_000);
  // Quiet hours are at most 16 hours, so the end is found within a day. Step by minutes: simple, and right across any time zone rule.
  for (let i = 0; i < 24 * 60 + 5; i++) {
    t = new Date(t.getTime() + 60_000);
    if (!isQuiet(t, q)) return t;
  }
  return at;
}

export const SPEED_CHOICES = [
  { perMinute: 0, label: 'As fast as possible' },
  { perMinute: 600, label: 'Steady: 600 a minute' },
  { perMinute: 120, label: 'Gentle: 120 a minute' },
  { perMinute: 30, label: 'Slow: 30 a minute' },
] as const;
export const MAX_PER_MINUTE = 6000;

export function checkSpeed(perMinute: number | null | undefined): string | null {
  if (perMinute === null || perMinute === undefined || perMinute === 0) return null;
  if (!Number.isInteger(perMinute) || perMinute < 1) return 'Choose a whole number of messages per minute.';
  if (perMinute > MAX_PER_MINUTE) return `Speed can be ${MAX_PER_MINUTE} messages a minute at most.`;
  return null;
}

/**
 * When message number `index` (0-based) may start. With no limit everything starts at `start`; with a limit, each minute lets
 * `perMinute` messages go, in order. The last message of a 1,000-person send at 120 a minute starts about 8 minutes in.
 */
export function startTimeFor(index: number, perMinute: number | null | undefined, start: Date): Date {
  if (!perMinute || perMinute <= 0) return start;
  return new Date(start.getTime() + Math.floor(index / perMinute) * 60_000);
}

/** How long a whole send takes at a speed, in whole minutes (0 when everything goes at once). For the review screen. */
export function minutesToSend(count: number, perMinute: number | null | undefined): number {
  if (!perMinute || perMinute <= 0 || count <= perMinute) return 0;
  return Math.ceil(count / perMinute) - 1;
}

/** "9 am", "9:30 pm" style label for an hour, for plain-language screens. */
export function hourLabel(h: number): string {
  const ampm = h < 12 ? 'am' : 'pm'; const x = h % 12 === 0 ? 12 : h % 12;
  return `${x} ${ampm}`;
}
