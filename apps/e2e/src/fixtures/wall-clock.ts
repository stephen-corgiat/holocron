import type { ClockFixture } from './clock';

/**
 * Fixed civil instant clock-sensitive specs anchor to: noon UTC on a stable
 * weekday (2026-05-04, a Monday — the same day the e2e reset defaults to).
 *
 * Deliberately mid-day, far from any civil-day boundary. These specs apply
 * ±5-minute offsets and then advance the clock another few minutes; anchored
 * near midnight, those offsets straddle the UTC day boundary, which makes
 * occurrence generation anchor a task's `scheduled_at` to an adjacent civil
 * day — either materializing a *second* occurrence on the next day (two Misses
 * fire → double penalty) or pushing the deadline ~24h out (the Miss never
 * fires). That used to flake the Miss specs whenever the suite ran in the few
 * minutes around UTC midnight. Anchoring at noon removes the dependence on the
 * real wall-clock time-of-day entirely.
 */
const CLOCK_ANCHOR = new Date('2026-05-04T12:00:00.000Z');

/**
 * Set the API's FakeClock to {@link CLOCK_ANCHOR} plus an optional offset
 * (milliseconds; negative = earlier) and pin the browser's `Date` to the same
 * instant. Use this for any spec where the browser's `Date.now()` matters — the
 * tablet renders `late_complete_until` countdowns from `new Date()`, so the
 * fake clock and the browser must agree. `clock.set` pins both, so the two stay
 * in exact lockstep regardless of when the suite actually runs.
 *
 * Returns the anchored instant so callers can derive due-times from it.
 */
export async function anchorClock(
  clock: ClockFixture,
  offsetMs = 0,
): Promise<Date> {
  const target = new Date(CLOCK_ANCHOR.getTime() + offsetMs);
  await clock.set(target);
  return target;
}

/**
 * "HH:MM" of `date` in UTC — for task `due_time` fields. The API runs with
 * TZ=UTC under e2e (see playwright.config.ts) and the e2e reset pins the
 * household zone to UTC, so UTC formatting matches.
 */
export function dueTimeUtc(date: Date): string {
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
