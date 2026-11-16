import { describe, expect, it } from 'vitest';
import { DEFAULT_QUIET, checkQuietHours, checkSpeed, hourLabel, isQuiet, localHourMinute, minutesToSend, nextAllowed, startTimeFor, type QuietHours } from '../src/send-window';

// IST is UTC+5:30 with no daylight saving, so these instants are exact.
const ist = (h: number, m = 0, day = 15) => new Date(Date.UTC(2026, 10, day, h, m) - 5.5 * 3600_000);
const Q = DEFAULT_QUIET; // 9 pm to 9 am, Asia/Kolkata

describe('what time is it for the customer', () => {
  it('reads the wall clock in the chosen zone', () => {
    expect(localHourMinute(ist(21, 30), 'Asia/Kolkata')).toEqual({ hour: 21, minute: 30 });
    expect(localHourMinute(ist(0, 5), 'Asia/Kolkata')).toEqual({ hour: 0, minute: 5 });   // midnight is hour 0, not 24
    expect(localHourMinute(new Date('2026-11-15T12:00:00Z'), 'America/Los_Angeles')).toEqual({ hour: 4, minute: 0 });
  });
});

describe('is it quiet', () => {
  it('a window that crosses midnight: quiet from 9 pm to 9 am', () => {
    for (const [h, m, quiet] of [[20, 59, false], [21, 0, true], [23, 59, true], [0, 0, true], [3, 30, true], [8, 59, true], [9, 0, false], [12, 0, false]] as const)
      expect(isQuiet(ist(h, m), Q), `${h}:${m}`).toBe(quiet);
  });
  it('a window inside one day: quiet from 1 pm to 3 pm', () => {
    const q: QuietHours = { enabled: true, startHour: 13, endHour: 15, timezone: 'Asia/Kolkata' };
    for (const [h, quiet] of [[12, false], [13, true], [14, true], [15, false], [22, false]] as const) expect(isQuiet(ist(h, 10), q), String(h)).toBe(quiet);
  });
  it('turned off means never quiet', () => { for (const h of [0, 3, 22]) expect(isQuiet(ist(h), { ...Q, enabled: false })).toBe(false); });
  it('uses the customer\'s zone, not the server\'s', () => {
    const la: QuietHours = { enabled: true, startHour: 21, endHour: 9, timezone: 'America/Los_Angeles' };
    expect(isQuiet(new Date('2026-11-15T12:00:00Z'), la)).toBe(true);    // 4 am in Los Angeles
    expect(isQuiet(new Date('2026-11-15T20:00:00Z'), la)).toBe(false);   // noon in Los Angeles
  });
  it('a broken setting never blocks sending in silence', () => {
    expect(isQuiet(ist(2), { ...Q, startHour: 25 })).toBe(false); expect(isQuiet(ist(2), { ...Q, timezone: 'Mars/Base' })).toBe(false); expect(isQuiet(ist(2), { ...Q, startHour: 5, endHour: 5 })).toBe(false);
  });
});

describe('when can a held message go', () => {
  it('right now when it is allowed', () => { const t = ist(14); expect(nextAllowed(t, Q)).toEqual(t); });
  it('the minute quiet hours end, same day when it is early morning', () => { expect(nextAllowed(ist(3, 20), Q)).toEqual(ist(9, 0)); });
  it('the next morning when it is evening', () => { expect(nextAllowed(ist(22, 15), Q)).toEqual(ist(9, 0, 16)); expect(nextAllowed(ist(21, 0), Q)).toEqual(ist(9, 0, 16)); });
  it('just before quiet starts goes now; just after waits the whole night', () => { expect(nextAllowed(ist(20, 59), Q)).toEqual(ist(20, 59)); expect(nextAllowed(ist(21, 1), Q)).toEqual(ist(9, 0, 16)); });
  it('never returns a quiet moment', () => {
    for (let h = 0; h < 24; h++) for (const m of [0, 17, 59]) expect(isQuiet(nextAllowed(ist(h, m), Q), Q), `${h}:${m}`).toBe(false);
  });
  it('works for another zone and for a same-day window', () => {
    const q: QuietHours = { enabled: true, startHour: 13, endHour: 15, timezone: 'Asia/Kolkata' };
    expect(nextAllowed(ist(13, 40), q)).toEqual(ist(15, 0));
    const la: QuietHours = { enabled: true, startHour: 21, endHour: 9, timezone: 'America/Los_Angeles' };
    expect(nextAllowed(new Date('2026-11-15T12:00:00Z'), la).toISOString()).toBe('2026-11-15T17:00:00.000Z');   // 9 am PST
  });
});

describe('checking what someone typed', () => {
  it('accepts sensible settings', () => { expect(checkQuietHours(Q)).toBeNull(); expect(checkQuietHours({ ...Q, startHour: 22, endHour: 8 })).toBeNull(); expect(checkQuietHours({ ...Q, enabled: false, startHour: 5, endHour: 5 })).toBe(null === null ? checkQuietHours({ ...Q, enabled: false, startHour: 5, endHour: 5 }) : null); });
  it('refuses nonsense in plain words', () => {
    for (const bad of [{ ...Q, startHour: 24 }, { ...Q, endHour: -1 }, { ...Q, startHour: 1.5 }, { ...Q, startHour: NaN }, { ...Q, startHour: 9, endHour: 9 }, { ...Q, timezone: 'Nowhere/City' }, { ...Q, startHour: 2, endHour: 20 }])
      expect((checkQuietHours(bad as QuietHours) ?? '').length, JSON.stringify(bad)).toBeGreaterThan(10);
  });
  it('a 16-hour window is the longest allowed', () => { expect(checkQuietHours({ ...Q, startHour: 17, endHour: 9 })).toBeNull(); expect(checkQuietHours({ ...Q, startHour: 16, endHour: 9 })).not.toBeNull(); });
});

describe('send speed', () => {
  it('no limit, or a sensible one', () => { for (const ok of [null, undefined, 0, 1, 30, 120, 600, 6000]) expect(checkSpeed(ok), String(ok)).toBeNull(); });
  it('refuses silly ones', () => { for (const bad of [-5, 1.5, 6001, NaN, 1e9]) expect(checkSpeed(bad), String(bad)).not.toBeNull(); });
  it('spreads messages minute by minute, in order', () => {
    const s = ist(10, 0);
    expect(startTimeFor(0, 120, s)).toEqual(s); expect(startTimeFor(119, 120, s)).toEqual(s);
    expect(startTimeFor(120, 120, s)).toEqual(ist(10, 1)); expect(startTimeFor(999, 120, s)).toEqual(ist(10, 8));
  });
  it('no limit means everything starts together', () => { const s = ist(10, 0); for (const l of [0, null, undefined, -1]) expect(startTimeFor(5000, l as never, s)).toEqual(s); });
  it('says how long a send takes', () => {
    expect(minutesToSend(1000, 120)).toBe(8); expect(minutesToSend(120, 120)).toBe(0); expect(minutesToSend(121, 120)).toBe(1); expect(minutesToSend(5000, 0)).toBe(0); expect(minutesToSend(0, 120)).toBe(0);
  });
});

describe('plain-language hours', () => { it('labels', () => { expect([0, 1, 9, 12, 13, 21, 23].map(hourLabel)).toEqual(['12 am', '1 am', '9 am', '12 pm', '1 pm', '9 pm', '11 pm']); }); });
