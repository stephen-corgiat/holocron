/**
 * Time-zone helpers for materializing wall-clock-in-tz instants.
 *
 * Background: `due_time` on a task is a wall-clock HH:MM in the household's
 * configured time zone. To build a `scheduled_at` UTC instant we need to
 * interpret "11:30" as 11:30 in that tz, then convert to UTC — which the
 * process's local TZ alone can't do reliably (the API container typically
 * runs in UTC). These helpers do the IANA-aware conversion without bringing
 * in a runtime dependency: `Intl.DateTimeFormat` already knows every zone.
 */

export interface Ymd {
  year: number;
  month: number; // 0-indexed, matching Date#getMonth
  day: number;
}

const ymdFormatterCache = new Map<string, Intl.DateTimeFormat>();
const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function ymdFormatter(tz: string): Intl.DateTimeFormat {
  let f = ymdFormatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    ymdFormatterCache.set(tz, f);
  }
  return f;
}

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsFormatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatterCache.set(tz, f);
  }
  return f;
}

/** Year/month/day as observed when the given instant is rendered in `tz`. */
export function ymdInTz(instant: Date, tz: string): Ymd {
  const parts = ymdFormatter(tz).formatToParts(instant);
  const get = (t: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === t)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month') - 1,
    day: get('day'),
  };
}

/**
 * The UTC instant that corresponds to wall-clock `hh:mm:ss` on `(year, month,
 * day)` in `tz`. Resolves the offset for that specific local time, so DST
 * shifts come out right.
 *
 * Spring-forward ambiguity: 02:30 on a spring-forward day doesn't exist
 * locally; we return the instant that the host TZ database resolves to
 * (typically equivalent to 03:30 wall-clock). Fall-back ambiguity: 01:30 on
 * a fall-back day occurs twice; we resolve to the first occurrence. Neither
 * matters for routine due-times in practice.
 */
export function utcInstantFor(
  year: number,
  month: number,
  day: number,
  hh: number,
  mm: number,
  ss: number,
  tz: string,
): Date {
  // First pass: pretend the wall time IS UTC and use that to probe the tz offset.
  const candidate = Date.UTC(year, month, day, hh, mm, ss);
  const offsetMin = tzOffsetMinutesAt(candidate, tz);
  // Second pass: refine using the offset at the candidate moment.
  const refined = candidate - offsetMin * 60_000;
  const refinedOffset = tzOffsetMinutesAt(refined, tz);
  return new Date(candidate - refinedOffset * 60_000);
}

/**
 * Offset (minutes east of UTC) that `tz` is at the given instant. Computed
 * by formatting the instant in `tz` and re-interpreting the result as UTC.
 */
export function tzOffsetMinutesAt(instantMs: number, tz: string): number {
  const parts = partsFormatter(tz).formatToParts(new Date(instantMs));
  const get = (t: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === t)?.value ?? '0');
  const wallMs = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((wallMs - instantMs) / 60_000);
}

/** UTC instant for midnight (00:00:00) on the given Ymd in `tz`. */
export function startOfDayInTz(ymd: Ymd, tz: string): Date {
  return utcInstantFor(ymd.year, ymd.month, ymd.day, 0, 0, 0, tz);
}

/**
 * UTC instant for the last millisecond (23:59:59.999) of the local civil day
 * `ymd` in `tz`. Inclusive upper bound for `BETWEEN`-style day-window queries.
 */
export function endOfDayInTz(ymd: Ymd, tz: string): Date {
  const nextMidnight = addDaysInTz(startOfDayInTz(ymd, tz), 1, tz);
  return new Date(nextMidnight.getTime() - 1);
}

/**
 * Local-civil-day arithmetic: the UTC instant of midnight `days` calendar days
 * away from the civil day that contains `instant`, in `tz`. Anchors to local
 * midnight (time-of-day is dropped) and is DST-correct — adding 1 day across a
 * spring-forward still lands on the next civil midnight, not 23 or 25h later.
 */
export function addDaysInTz(instant: Date, days: number, tz: string): Date {
  const ymd = ymdInTz(instant, tz);
  // Shift the civil date using a UTC scratch Date (calendar math only), then
  // resolve the shifted Y/M/D back to a local-midnight instant.
  const scratch = new Date(Date.UTC(ymd.year, ymd.month, ymd.day));
  scratch.setUTCDate(scratch.getUTCDate() + days);
  return startOfDayInTz(
    {
      year: scratch.getUTCFullYear(),
      month: scratch.getUTCMonth(),
      day: scratch.getUTCDate(),
    },
    tz,
  );
}

/** Civil date `YYYY-MM-DD` as observed when `instant` is rendered in `tz`. */
export function isoDateInTz(instant: Date, tz: string): string {
  const { year, month, day } = ymdInTz(instant, tz);
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Day of week (0=Sunday … 6=Saturday) of the civil day containing `instant` in `tz`. */
export function dayOfWeekInTz(instant: Date, tz: string): number {
  const { year, month, day } = ymdInTz(instant, tz);
  return new Date(Date.UTC(year, month, day)).getUTCDay();
}

/** Minutes since local midnight (0–1439) as observed for `instant` in `tz`. */
export function minutesOfDayInTz(instant: Date, tz: string): number {
  const parts = partsFormatter(tz).formatToParts(instant);
  const get = (t: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === t)?.value ?? '0');
  const hour = get('hour') === 24 ? 0 : get('hour');
  return hour * 60 + get('minute');
}

/** Hour-of-day (0–23) as observed when `instant` is rendered in `tz`. */
export function hourInTz(instant: Date, tz: string): number {
  const parts = partsFormatter(tz).formatToParts(instant);
  return Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
}

/**
 * Wall-clock time as observed when `instant` is rendered in `tz`, formatted
 * 12-hour with an `AM`/`PM` marker (e.g. `4:45 PM`, `12:00 AM`). This is the
 * household-local time the tablet should show — it pins the displayed time to
 * the configured zone instead of whatever zone the browser or API process
 * happens to run in. The marker style matches `Intl` en-US so every time the
 * UI shows reads consistently.
 */
export function wallClockInTz(instant: Date, tz: string): string {
  const parts = partsFormatter(tz).formatToParts(instant);
  const get = (t: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === t)?.value ?? '00';
  const hour24 = Number(get('hour')) % 24;
  const minute = get('minute').padStart(2, '0');
  const period = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minute} ${period}`;
}
