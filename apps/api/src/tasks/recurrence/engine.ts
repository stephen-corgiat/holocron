import {
  DateRange,
  DayOfWeek,
  Occurrence,
  RecurrencePattern,
  WeekdayOrdinal,
} from './types';

/**
 * Pure recurrence engine: expand a pattern + calendar range into an
 * ordered list of Occurrences. The engine works in calendar terms
 * (year/month/day from `Date#getFullYear` etc.) and is intentionally
 * timezone-agnostic.
 *
 * **Caller contract (household tz):** because the engine reads runtime-local
 * calendar fields, callers must pass `range` Dates and `pattern.anchor` that
 * encode the *household civil day*. The occurrence generator does this via
 * `civilDayToken(date, tz)` — a `new Date(y, m, d)` built from the household
 * Y/M/D — so the engine's `getDate()/getDay()` reads yield the household civil
 * date regardless of the API process's own zone. The anchor string
 * (`YYYY-MM-DD`) is likewise a household civil date. Wall-clock time-of-day is
 * applied *after* expansion via `combineDateAndDueTime(date, due_time, tz)`.
 *
 * Adding a new preset means adding one more
 * branch to `expand` — no other call sites should need to change.
 */
export function expand(
  pattern: RecurrencePattern,
  range: DateRange,
): Occurrence[] {
  const from = startOfLocalDay(range.from);
  const to = startOfLocalDay(range.to);
  if (to < from) return [];

  switch (pattern.preset) {
    case 'daily':
      return walkDays(from, to, () => true);
    case 'weekdays':
      return walkDays(from, to, (d) => {
        const dow = d.getDay();
        return dow >= 1 && dow <= 5;
      });
    case 'weekends':
      return walkDays(from, to, (d) => {
        const dow = d.getDay();
        return dow === 0 || dow === 6;
      });
    case 'weekly': {
      const set = new Set(pattern.days);
      return walkDays(from, to, (d) => set.has(d.getDay() as DayOfWeek));
    }
    case 'biweekly': {
      const set = new Set(pattern.days);
      const anchor = parseAnchor(pattern.anchor);
      return walkDays(from, to, (d) => {
        if (!set.has(d.getDay() as DayOfWeek)) return false;
        const weeks = wholeWeeksBetween(anchor, d);
        return weeks % 2 === 0;
      });
    }
    case 'every_n_days': {
      if (pattern.n <= 0) return [];
      const anchor = parseAnchor(pattern.anchor);
      return walkDays(from, to, (d) => {
        const diff = wholeDaysBetween(anchor, d);
        return diff >= 0 && diff % pattern.n === 0;
      });
    }
    case 'every_n_weeks': {
      if (pattern.n <= 0) return [];
      const set = new Set(pattern.days);
      const anchor = parseAnchor(pattern.anchor);
      return walkDays(from, to, (d) => {
        if (!set.has(d.getDay() as DayOfWeek)) return false;
        const weeks = wholeWeeksBetween(anchor, d);
        return weeks >= 0 && weeks % pattern.n === 0;
      });
    }
    case 'every_n_months': {
      if (pattern.n <= 0) return [];
      const anchor = parseAnchor(pattern.anchor);
      return walkDays(from, to, (d) => {
        if (d.getDate() !== pattern.day_of_month) return false;
        const monthsDiff =
          (d.getFullYear() - anchor.getFullYear()) * 12 +
          (d.getMonth() - anchor.getMonth());
        return monthsDiff >= 0 && monthsDiff % pattern.n === 0;
      });
    }
    case 'yearly_on_date': {
      // Feb-29 policy: skip the year entirely when the date doesn't exist.
      // Snapping to Feb 28 or Mar 1 would silently double-fire in adjacent
      // years for leap-day birthdays; skipping is the least-surprising
      // default; a household setting could expose it later.
      return walkDays(from, to, (d) => {
        return (
          d.getMonth() + 1 === pattern.month && d.getDate() === pattern.day
        );
      });
    }
    case 'yearly_in_month': {
      const out: Occurrence[] = [];
      const firstYear = from.getFullYear();
      const lastYear = to.getFullYear();
      for (let y = firstYear; y <= lastYear; y++) {
        const date = nthWeekdayOfMonth(
          y,
          pattern.month,
          pattern.ordinal,
          pattern.day_of_week,
        );
        if (date && date >= from && date <= to) {
          out.push({ date });
        }
      }
      return out;
    }
  }
}

function walkDays(
  from: Date,
  to: Date,
  predicate: (d: Date) => boolean,
): Occurrence[] {
  const out: Occurrence[] = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    if (predicate(cursor)) {
      out.push({ date: new Date(cursor) });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseAnchor(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) {
    // Fall back to parsing whatever was supplied; treat it as a local date.
    const fallback = new Date(value);
    return startOfLocalDay(fallback);
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Whole-day distance from `a` to `b` working in local-calendar units.
 * Uses UTC-midnight projection so a DST transition between the two dates
 * doesn't shift the count by a partial day.
 */
function wholeDaysBetween(a: Date, b: Date): number {
  const ad = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const bd = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((bd - ad) / 86400_000);
}

function wholeWeeksBetween(a: Date, b: Date): number {
  return Math.floor(wholeDaysBetween(a, b) / 7);
}

function nthWeekdayOfMonth(
  year: number,
  month: number, // 1-12
  ordinal: WeekdayOrdinal,
  dayOfWeek: DayOfWeek,
): Date | null {
  if (ordinal === -1) {
    // Last <dayOfWeek> of the month: walk back from the last day.
    const last = new Date(year, month, 0); // day 0 = last of previous (1-based month)
    const diff = (last.getDay() - dayOfWeek + 7) % 7;
    return new Date(year, month - 1, last.getDate() - diff);
  }
  const first = new Date(year, month - 1, 1);
  const offset = (dayOfWeek - first.getDay() + 7) % 7;
  const day = 1 + offset + (ordinal - 1) * 7;
  // Past month end → ordinal doesn't exist this year (e.g. 5th Friday of Feb).
  const probe = new Date(year, month - 1, day);
  if (probe.getMonth() !== month - 1) return null;
  return probe;
}
