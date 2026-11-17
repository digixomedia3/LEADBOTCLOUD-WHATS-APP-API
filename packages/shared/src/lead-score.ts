/**
 * Lead scoring. Pure functions, so every number a person sees is tested.
 *
 * A score from 0 to 100 says how likely a lead is to be worth a call RIGHT NOW. It is built only from things the lead really did, and every
 * point can be explained ("Replied +25"). It is never a black box, and it is never used to message anyone by itself: it sorts and labels.
 *
 * Fixed outcomes (not weighted, so nobody can tune a closed lead into looking hot):
 *   won -> 100 "won";  lost or junk -> 0 "closed";  opted out -> at most 5 "cold".
 */
export const BASE_SCORE = 10;
export const HOT_FROM = 70, WARM_FROM = 40;

/** What each signal is worth, in points. Every workspace starts from these and may change them within the limits. */
export const DEFAULT_WEIGHTS = {
  reply: 25,       // per reply from the person since the lead arrived (at most 2 count)
  read: 10,        // read at least one message we sent
  click: 20,       // clicked a tracked link (a person, not a link-preview robot)
  agreed: 10,      // gave permission for WhatsApp messages
  email: 5,        // left an email address
  value: 10,       // someone put a deal value on the lead
  resubmit: 5,     // per extra time they filled the form again (at most 2 count)
  contacted: 5,    // a person has already been in touch
  qualified: 15,   // a person marked them qualified
  idle: 5,         // taken off per full week of silence after the first week (at most 5 weeks)
} as const;
export type WeightKey = keyof typeof DEFAULT_WEIGHTS;
export type Weights = Record<WeightKey, number>;
export const WEIGHT_KEYS = Object.keys(DEFAULT_WEIGHTS) as WeightKey[];
export const MAX_WEIGHT = 50, MAX_IDLE_WEIGHT = 20;
export const weightMax = (k: WeightKey) => (k === 'idle' ? MAX_IDLE_WEIGHT : MAX_WEIGHT);

export const WEIGHT_LABEL: Record<WeightKey, { label: string; hint: string }> = {
  reply: { label: 'Replied', hint: 'Each reply since they arrived. Two replies count at most.' },
  read: { label: 'Read a message', hint: 'Opened at least one message you sent them.' },
  click: { label: 'Clicked a link', hint: 'Opened a tracked link from one of your campaigns. Link-preview robots do not count.' },
  agreed: { label: 'Agreed to messages', hint: 'Gave permission to be messaged on WhatsApp.' },
  email: { label: 'Left an email', hint: 'Gave an email address as well as a phone number.' },
  value: { label: 'Has a deal value', hint: 'Someone on your team put a value on this lead.' },
  resubmit: { label: 'Came back again', hint: 'Each extra time they filled in your form. Two count at most.' },
  contacted: { label: 'Already contacted', hint: 'A person on your team has been in touch.' },
  qualified: { label: 'Marked qualified', hint: 'A person on your team marked them as a real prospect.' },
  idle: { label: 'Gone quiet (taken off)', hint: 'Taken off for each full week since they last did anything (arrived, replied, read or clicked). Five weeks count at most.' },
};

/** Reads stored weights. Missing, unreadable or out-of-range values fall back to the default for that signal, so a damaged setting can never produce a strange score. */
export function parseWeights(raw: unknown): Weights {
  const out = { ...DEFAULT_WEIGHTS } as Weights;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const k of WEIGHT_KEYS) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= weightMax(k)) out[k] = v;
    }
  }
  return out;
}

/** Checks weights typed in by a person. Returns plain-words problems; null when fine. */
export function weightsProblem(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'Check the scoring rules.';
  for (const k of WEIGHT_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v !== 'number' || !Number.isInteger(v)) return `“${WEIGHT_LABEL[k].label}” must be a whole number.`;
    if (v < 0 || v > weightMax(k)) return `“${WEIGHT_LABEL[k].label}” must be between 0 and ${weightMax(k)}.`;
  }
  const extra = Object.keys(raw as object).filter((k) => !(WEIGHT_KEYS as string[]).includes(k));
  return extra.length ? 'Unknown scoring rule.' : null;
}

export interface LeadSignals {
  status: string;
  consent: string;               // allowed | unknown | stopped
  replies: number;               // inbound messages since the lead arrived
  reads: number;                 // our messages they read since the lead arrived
  clicks: number;                // different tracked links a person (not a robot) opened
  hasEmail: boolean;
  valuePaise: number;
  submissions: number;           // 1 for a single form fill
  lastActivityAt: Date;          // latest of: arrival, a reply, a read, a click
  now: Date;
}

export type Band = 'hot' | 'warm' | 'cold' | 'won' | 'closed';
export interface ScoreReason { label: string; points: number }
export interface Score { score: number; band: Band; reasons: ScoreReason[] }

export const bandFor = (n: number): 'hot' | 'warm' | 'cold' => (n >= HOT_FROM ? 'hot' : n >= WARM_FROM ? 'warm' : 'cold');
const WEEK_MS = 7 * 86_400_000;

export function scoreLead(s: LeadSignals, w: Weights = DEFAULT_WEIGHTS): Score {
  if (s.status === 'won') return { score: 100, band: 'won', reasons: [{ label: 'Won', points: 0 }] };
  if (s.status === 'lost' || s.status === 'junk') return { score: 0, band: 'closed', reasons: [{ label: s.status === 'lost' ? 'Lost' : 'Marked as junk', points: 0 }] };

  const reasons: ScoreReason[] = [{ label: 'Starting point', points: BASE_SCORE }];
  const add = (label: string, points: number) => { if (points !== 0) reasons.push({ label, points }); };

  const replies = Math.min(2, Math.max(0, Math.floor(s.replies)));
  add(replies === 1 ? 'Replied' : `Replied ${replies} times`, replies * w.reply);
  if (s.reads > 0) add('Read a message', w.read);
  if (s.clicks > 0) add('Clicked a link', w.click);
  if (s.consent === 'allowed') add('Agreed to messages', w.agreed);
  if (s.hasEmail) add('Left an email', w.email);
  if (s.valuePaise > 0) add('Has a deal value', w.value);
  const again = Math.min(2, Math.max(0, Math.floor(s.submissions) - 1));
  if (again > 0) add(again === 1 ? 'Came back once' : 'Came back twice or more', again * w.resubmit);
  if (s.status === 'contacted') add('Already contacted', w.contacted);
  if (s.status === 'qualified') add('Marked qualified', w.qualified);

  // Silence: nothing from them for over a week. Measured from their last real action, never from our own messages.
  const idleMs = s.now.getTime() - s.lastActivityAt.getTime();
  const idleWeeks = Math.min(5, Math.max(0, Math.floor(idleMs / WEEK_MS)));
  if (idleWeeks >= 1) add(`Quiet for ${idleWeeks} week${idleWeeks === 1 ? '' : 's'}`, -idleWeeks * w.idle);

  let score = reasons.reduce((n, r) => n + r.points, 0);
  score = Math.max(0, Math.min(100, Math.round(score)));
  if (s.consent === 'stopped') {
    reasons.push({ label: 'Opted out of messages', points: Math.min(0, 5 - score) });
    return { score: Math.min(score, 5), band: 'cold', reasons };
  }
  return { score, band: bandFor(score), reasons };
}

/** Sentence for the top of the lead panel. */
export function scoreHeadline(sc: Score): string {
  if (sc.band === 'won') return 'Won.';
  if (sc.band === 'closed') return 'Closed, so it is not scored.';
  return sc.band === 'hot' ? 'Hot: worth a call now.' : sc.band === 'warm' ? 'Warm: showing some interest.' : 'Cold: little sign of interest yet.';
}
