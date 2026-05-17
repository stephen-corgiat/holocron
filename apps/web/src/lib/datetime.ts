/**
 * Household-timezone date/time helpers for the browser — the frontend
 * counterpart to the API's `clock/tz.ts`. Every wall-clock the UI shows is
 * rendered in the configured household zone (via `Intl.DateTimeFormat`), not
 * the browser's own zone, so a wall tablet (or an admin laptop) physically in
 * a different zone still displays household-local time.
 *
 * Instants are always real UTC `Date`s / ISO strings; only the *projection*
 * to wall-clock is zone-aware. The one exception is `utcInstantInTz`, which
 * goes the other way — turning a wall-clock the admin typed into the UTC
 * instant it denotes in the household zone.
 */

const DOW_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
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
      weekday: 'short',
    });
    partsCache.set(tz, f);
  }
  return f;
}

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
  weekday: number; // 0=Sun..6=Sat
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function zonedParts(instant: Date, tz: string): ZonedParts {
  const out: Partial<ZonedParts> = {};
  for (const p of partsFormatter(tz).formatToParts(instant)) {
    switch (p.type) {
      case 'year':
        out.year = Number(p.value);
        break;
      case 'month':
        out.month = Number(p.value);
        break;
      case 'day':
        out.day = Number(p.value);
        break;
      case 'hour':
        out.hour = Number(p.value) === 24 ? 0 : Number(p.value);
        break;
      case 'minute':
        out.minute = Number(p.value);
        break;
      case 'second':
        out.second = Number(p.value);
        break;
      case 'weekday':
        out.weekday = WEEKDAY_INDEX[p.value] ?? 0;
        break;
    }
  }
  return out as ZonedParts;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Wall-clock time in the household zone, formatted 12-hour with an `AM`/`PM`
 * marker (e.g. `4:45 PM`, `12:00 AM`). The marker style matches `Intl` en-US
 * so every time the UI shows reads consistently.
 */
export function wallClockInTz(value: Date | string, tz: string): string {
  const p = zonedParts(toDate(value), tz);
  const period = p.hour < 12 ? 'AM' : 'PM';
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${hour12}:${pad(p.minute)} ${period}`;
}

/**
 * Format a plain wall-clock string (`HH:MM` or `HH:MM:SS`, already in
 * household-local terms — e.g. a task's `due_time`) as 12-hour with an
 * `AM`/`PM` marker (`15:00` → `3:00 PM`). Returns the input unchanged if it
 * isn't a recognizable `H:MM` shape. No time-zone conversion happens here.
 */
export function clockLabel(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  const hour24 = Number(m[1]) % 24;
  const period = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${m[2]} ${period}`;
}

/** Hour-of-day (0-23) in the household zone. */
export function hourInTz(value: Date | string, tz: string): number {
  return zonedParts(toDate(value), tz).hour;
}

/** Day-of-week (0=Sun..6=Sat) in the household zone. */
export function dowInTz(value: Date | string, tz: string): number {
  return zonedParts(toDate(value), tz).weekday;
}

/** Civil date `YYYY-MM-DD` in the household zone. */
export function isoDateInTz(value: Date | string, tz: string): string {
  const p = zonedParts(toDate(value), tz);
  return `${String(p.year).padStart(4, '0')}-${pad(p.month)}-${pad(p.day)}`;
}

/** Dotted status date `YYYY·MM·DD` in the household zone. */
export function dottedDateInTz(value: Date | string, tz: string): string {
  const p = zonedParts(toDate(value), tz);
  return `${p.year}·${pad(p.month)}·${pad(p.day)}`;
}

/** Short weekday label (`MON`) in the household zone. */
export function dowLabelInTz(value: Date | string, tz: string): string {
  return DOW_SHORT[dowInTz(value, tz)];
}

/**
 * The UTC instant denoted by a `datetime-local` / wall-clock string
 * (`YYYY-MM-DDTHH:MM` or `YYYY-MM-DD HH:MM`) interpreted in the household
 * zone. Used when an admin types a time/date that should mean household-local
 * time regardless of the admin's own browser zone. DST-correct via a two-pass
 * offset solve.
 */
export function utcInstantInTz(local: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(local);
  if (!m) return new Date(local);
  const [, y, mo, d, h, mi, s] = m;
  const asUtc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    s ? Number(s) : 0,
  );
  let guess = new Date(asUtc);
  for (let i = 0; i < 2; i++) {
    guess = new Date(asUtc - zoneOffsetMs(guess, tz));
  }
  return guess;
}

/** Offset (ms, east-positive) of `tz` at `instant`. */
function zoneOffsetMs(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - instant.getTime();
}

/** `YYYY-MM-DD` of "today" in the household zone — for date-input defaults. */
export function todayIsoInTz(tz: string): string {
  return isoDateInTz(new Date(), tz);
}

/**
 * `YYYY-MM-DDTHH:MM` of "now" in the household zone — for `datetime-local`
 * input defaults. Optionally overrides the hour and zeroes the minutes.
 */
export function nowDatetimeLocalInTz(tz: string, hourOverride?: number): string {
  const p = zonedParts(new Date(), tz);
  const hour = hourOverride ?? p.hour;
  const minute = hourOverride === undefined ? p.minute : 0;
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(hour)}:${pad(minute)}`;
}
