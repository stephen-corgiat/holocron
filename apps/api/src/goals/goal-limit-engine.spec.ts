import {
  canComplete,
  countInWindow,
  remainingInWindow,
  windowBounds,
} from './goal-limit-engine';

const TZ = 'America/Los_Angeles';
const goal = (limit: number, window: 'day' | 'week' | 'month' | 'lifetime') => ({
  completionLimit: limit,
  limitWindow: window,
});
const at = (iso: string) => ({ completedAt: new Date(iso) });

describe('windowBounds', () => {
  it('day: local-midnight to next local-midnight in the household TZ', () => {
    const now = new Date('2026-05-15T18:30:00Z'); // 11:30 PT
    const { start, end } = windowBounds('day', now, TZ);
    // PT is UTC-7 in May (DST), so local midnight = 07:00 UTC
    expect(start.toISOString()).toBe('2026-05-15T07:00:00.000Z');
    expect(end.toISOString()).toBe('2026-05-16T07:00:00.000Z');
  });

  it('week: rolls back to ISO Monday in the household TZ', () => {
    // 2026-05-15 is a Friday in PT; ISO week starts Monday 2026-05-11
    const now = new Date('2026-05-15T18:30:00Z');
    const { start, end } = windowBounds('week', now, TZ);
    expect(start.toISOString()).toBe('2026-05-11T07:00:00.000Z');
    expect(end.toISOString()).toBe('2026-05-18T07:00:00.000Z');
  });

  it('week: a Sunday belongs to the week that just ended (ISO)', () => {
    // 2026-05-17 is Sunday in PT
    const now = new Date('2026-05-17T20:00:00Z');
    const { start, end } = windowBounds('week', now, TZ);
    expect(start.toISOString()).toBe('2026-05-11T07:00:00.000Z');
    expect(end.toISOString()).toBe('2026-05-18T07:00:00.000Z');
  });

  it('month: calendar month in the household TZ', () => {
    const now = new Date('2026-05-31T20:00:00Z'); // Sunday May 31 in PT
    const { start, end } = windowBounds('month', now, TZ);
    expect(start.toISOString()).toBe('2026-05-01T07:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-01T07:00:00.000Z');
  });
});

describe('canComplete + countInWindow', () => {
  it('returns true when no prior completions exist', () => {
    const now = new Date('2026-05-15T18:00:00Z');
    expect(canComplete(goal(3, 'week'), now, [], { timeZone: TZ })).toBe(true);
  });

  it('counts only completions inside the current ISO week', () => {
    const now = new Date('2026-05-15T18:00:00Z'); // Fri PT, week of Mon 5/11
    const completions = [
      at('2026-05-10T12:00:00Z'), // Sun 5/10 PT — previous week
      at('2026-05-11T15:00:00Z'), // Mon 5/11 PT — inside
      at('2026-05-14T22:00:00Z'), // Thu 5/14 PT — inside
    ];
    expect(countInWindow(goal(3, 'week'), now, completions, { timeZone: TZ })).toBe(2);
  });

  it('blocks once limit reached in the week, allows again past Monday rollover', () => {
    const goalSpec = goal(2, 'week');
    const completions = [
      at('2026-05-11T15:00:00Z'),
      at('2026-05-12T15:00:00Z'),
    ];
    // Sunday 5/17 PT — still inside the same ISO week
    const sundayLate = new Date('2026-05-17T23:00:00Z');
    expect(canComplete(goalSpec, sundayLate, completions, { timeZone: TZ })).toBe(false);

    // Monday 5/18 PT just after local midnight — new ISO week
    const mondayMorning = new Date('2026-05-18T07:30:00Z');
    expect(canComplete(goalSpec, mondayMorning, completions, { timeZone: TZ })).toBe(true);
  });

  it('end-of-month rollover allows another completion past the 1st', () => {
    const goalSpec = goal(1, 'month');
    const inMay = [at('2026-05-31T20:00:00Z')];
    // Still May 31 PT
    const lateMay = new Date('2026-05-31T23:00:00Z');
    expect(canComplete(goalSpec, lateMay, inMay, { timeZone: TZ })).toBe(false);
    // June 1 PT (local midnight = 07:00 UTC)
    const earlyJune = new Date('2026-06-01T08:00:00Z');
    expect(canComplete(goalSpec, earlyJune, inMay, { timeZone: TZ })).toBe(true);
  });

  it('lifetime: every prior completion counts forever', () => {
    const goalSpec = goal(2, 'lifetime');
    const completions = [
      at('2020-01-01T00:00:00Z'),
      at('2024-06-15T00:00:00Z'),
    ];
    const now = new Date('2030-01-01T00:00:00Z');
    expect(canComplete(goalSpec, now, completions, { timeZone: TZ })).toBe(false);
    expect(remainingInWindow(goalSpec, now, completions, { timeZone: TZ })).toBe(0);
    expect(remainingInWindow(goalSpec, now, [completions[0]], { timeZone: TZ })).toBe(1);
  });
});
