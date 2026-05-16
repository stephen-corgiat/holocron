import type { LimitWindow } from './goal.entity';
import {
  addDaysInTz,
  dayOfWeekInTz,
  startOfDayInTz,
  ymdInTz,
} from '../clock/tz';

export interface GoalLimitSpec {
  completionLimit: number;
  limitWindow: LimitWindow;
}

export interface CompletionTimestamp {
  completedAt: Date;
}

export interface CanCompleteOptions {
  /** IANA time zone for resolving day/week/month boundaries. */
  timeZone: string;
}

/**
 * Pure predicate: can this Trackee record another completion of this goal right
 * now? Computes a [windowStart, windowEnd) interval in the household time zone
 * and counts prior completions whose `completedAt` falls inside.
 *
 * Window semantics:
 *  - `day`       — local civil day in `timeZone`
 *  - `week`      — ISO week, Monday 00:00 local through next Monday 00:00 local
 *  - `month`     — calendar month, 1st 00:00 local through next 1st 00:00 local
 *  - `lifetime`  — no boundary; every prior completion counts.
 */
export function canComplete(
  goal: GoalLimitSpec,
  now: Date,
  completions: CompletionTimestamp[],
  options: CanCompleteOptions,
): boolean {
  return countInWindow(goal, now, completions, options) < goal.completionLimit;
}

/** Number of completions in the goal's current window (for catalog "remaining" badges). */
export function countInWindow(
  goal: GoalLimitSpec,
  now: Date,
  completions: CompletionTimestamp[],
  options: CanCompleteOptions,
): number {
  if (goal.limitWindow === 'lifetime') return completions.length;
  const { start, end } = windowBounds(goal.limitWindow, now, options.timeZone);
  let count = 0;
  for (const c of completions) {
    const t = c.completedAt.getTime();
    if (t >= start.getTime() && t < end.getTime()) count++;
  }
  return count;
}

export function remainingInWindow(
  goal: GoalLimitSpec,
  now: Date,
  completions: CompletionTimestamp[],
  options: CanCompleteOptions,
): number {
  const used = countInWindow(goal, now, completions, options);
  return Math.max(0, goal.completionLimit - used);
}

interface WindowBounds {
  start: Date;
  end: Date;
}

/**
 * Compute [start, end) for the goal's window, anchored in `timeZone`.
 * Both bounds are UTC `Date`s representing the local-midnight instants.
 */
export function windowBounds(
  window: Exclude<LimitWindow, 'lifetime'>,
  now: Date,
  timeZone: string,
): WindowBounds {
  const ymd = ymdInTz(now, timeZone);
  if (window === 'day') {
    const start = startOfDayInTz(ymd, timeZone);
    const end = addDaysInTz(start, 1, timeZone);
    return { start, end };
  }
  if (window === 'week') {
    // ISO week: Monday is day 1, Sunday is day 7. Roll the local date back to
    // Monday before converting to a local-midnight UTC instant.
    const dow = dayOfWeekInTz(now, timeZone);
    const isoDow = dow === 0 ? 7 : dow;
    const dayMidnight = startOfDayInTz(ymd, timeZone);
    const start = addDaysInTz(dayMidnight, -(isoDow - 1), timeZone);
    const end = addDaysInTz(start, 7, timeZone);
    return { start, end };
  }
  // month — `ymd.month` is 0-indexed (matches Date#getMonth).
  const start = startOfDayInTz({ ...ymd, day: 1 }, timeZone);
  const nextMonth = ymd.month === 11 ? 0 : ymd.month + 1;
  const nextYear = ymd.month === 11 ? ymd.year + 1 : ymd.year;
  const end = startOfDayInTz(
    { year: nextYear, month: nextMonth, day: 1 },
    timeZone,
  );
  return { start, end };
}
