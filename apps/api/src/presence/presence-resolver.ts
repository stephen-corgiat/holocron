/**
 * Presence resolver — deep module per GLOSSARY.md.
 *
 * Public entry:
 *
 *   isHome(schedule, instant) → boolean
 *
 * Recurring rule shapes handled:
 *
 *   - 'none'        — no presence tracking; treated as always-home at runtime.
 *   - 'full_time'   — always home.
 *   - 'n_week_grid' — fixed-length mask of `[week_index][weekday_index]` cells
 *                     anchored by `epoch_date` (ISO `YYYY-MM-DD`). Each cell
 *                     is `{ kind: 'home' | 'away', handoff_time?: 'HH:MM' }`.
 *                     The engine snaps `epoch_date` to that week's ISO Monday
 *                     and uses modulo arithmetic for week-A/B alternation.
 *                     `weekday_index` 0..6 is Mon..Sun (ISO order).
 *
 * Hand-off semantics: a `handoff_time` on a cell defines a transition at that
 * local time-of-day to that cell's kind. A cell with no `handoff_time` adds
 * no transition — it inherits the running state from prior cells (so adjacent
 * home cells with no times are continuous, and a streak of away cells likewise
 * stays away). State at any instant is the kind of the most recent transition
 * at-or-before that instant.
 *
 * Time-zone: hand-off times, grid weekday alignment, and vacation-window date
 * comparisons are all evaluated in the household time zone passed as `tz`.
 * The civil day and minute-of-day of the instant are read in that zone, so a
 * `08:00` hand-off means 08:00 household-local regardless of the API process's
 * own zone.
 *
 * One-off windows (vacation overrides) are consulted as the final layer:
 * any instant whose household-local date falls within a window returns
 * `home = false`, regardless of what the recurring rule resolves to.
 */

import type { RecurringRuleKind, OneOffWindow } from './presence.entity';
import { isoDateInTz, minutesOfDayInTz, ymdInTz } from '../clock/tz';

export interface GridCell {
  kind: 'home' | 'away';
  /** ISO time-of-day `HH:MM` (24h). Absent = no transition on this day. */
  handoff_time?: string;
}

/** 2-D mask indexed by `[week_index][weekday_index]`, weekday 0=Mon..6=Sun. */
export type GridCells = GridCell[][];

export interface PresenceScheduleLike {
  recurringRuleKind: RecurringRuleKind;
  /** Required when `recurringRuleKind === 'n_week_grid'`. */
  gridNWeeks?: number | null;
  /** Required when `recurringRuleKind === 'n_week_grid'`. */
  gridCells?: GridCells | unknown | null;
  /** ISO `YYYY-MM-DD`; required when `recurringRuleKind === 'n_week_grid'`. */
  epochDate?: string | null;
  /** Vacation windows; any matching window overrides recurring rule to away. */
  oneOffWindows?: OneOffWindow[];
}

/**
 * Derived presence-suppression for an occurrence (ADR-0003). The occurrence's
 * effective time-of-day is taken from its `scheduledAt` (which the generator
 * already combines with `task.due_time`); when absent, the caller may pass
 * `effectiveAt` directly. An occurrence is suppressed if the Trackee is
 * not-home at that instant under the given schedule.
 */
export function isSuppressed(
  schedule: PresenceScheduleLike,
  effectiveAt: Date,
  tz: string,
): boolean {
  return !isHome(schedule, effectiveAt, tz);
}

export function isHome(
  schedule: PresenceScheduleLike,
  instant: Date,
  tz: string,
): boolean {
  if (inVacationWindow(schedule.oneOffWindows, instant, tz)) return false;

  switch (schedule.recurringRuleKind) {
    case 'full_time':
    case 'none':
      return true;
    case 'n_week_grid':
      return resolveGrid(schedule, instant, tz);
    default:
      return true;
  }
}

function inVacationWindow(
  windows: OneOffWindow[] | undefined,
  instant: Date,
  tz: string,
): boolean {
  if (!windows || windows.length === 0) return false;
  const instantDate = isoDateInTz(instant, tz);
  return windows.some((w) => instantDate >= w.start && instantDate <= w.end);
}

function resolveGrid(
  schedule: PresenceScheduleLike,
  instant: Date,
  tz: string,
): boolean {
  const N = schedule.gridNWeeks ?? 0;
  const cells = schedule.gridCells as GridCells | null | undefined;
  const epochISO = schedule.epochDate;
  // Defensive: a malformed grid degrades to "home" rather than punishing the
  // Trackee. Validation lives at the controller; if we got here with junk,
  // the admin UI is the right place to surface it.
  if (!N || !Array.isArray(cells) || !epochISO) return true;
  if (cells.length !== N) return true;

  const epochMonday = isoMondayOfISODate(epochISO);
  const dayOffset = civilDaysBetween(epochMonday, instant, tz);
  const instantMinutes = minutesOfDayInTz(instant, tz);
  const cycleDays = N * 7;

  // Walk back day-by-day, ≤ 2 cycles, looking for the most recent transition
  // at-or-before the instant. Two cycles is enough: any periodic schedule
  // with at least one transition repeats it within one cycle, and we need
  // up to one extra cycle of slack to find a transition that occurred before
  // the start of the current cycle.
  const maxBackDays = cycleDays * 2;
  for (let back = 0; back <= maxBackDays; back++) {
    const cell = cellAtOffset(cells, N, dayOffset - back);
    if (!cell) continue;
    const prev = cellAtOffset(cells, N, dayOffset - back - 1);
    const explicit = cell.handoff_time ? parseHHMM(cell.handoff_time) : null;
    // A transition is recorded when the cell has an explicit hand-off, OR
    // when the prior cell's kind differs and the time defaults to 00:00.
    // Same-kind adjacency without an explicit time is "continuous" — no
    // transition is emitted (per GLOSSARY.md's "adjacent home cells …
    // continuous" rule, generalised to away→away as well).
    const isFlip = prev != null && prev.kind !== cell.kind;
    if (explicit == null && !isFlip) continue;
    const handoffMin = explicit != null ? explicit : 0;
    if (back === 0) {
      if (instantMinutes >= handoffMin) return cell.kind === 'home';
      continue;
    }
    return cell.kind === 'home';
  }

  // No transitions anywhere in the cycle — the grid is uniformly one kind.
  // Read the current cell directly.
  const current = cellAtOffset(cells, N, dayOffset);
  return current ? current.kind === 'home' : true;
}

function cellAtOffset(
  cells: GridCells,
  N: number,
  dayOffset: number,
): GridCell | null {
  const total = N * 7;
  const idx = ((dayOffset % total) + total) % total;
  const weekIdx = Math.floor(idx / 7);
  const weekdayIdx = idx % 7;
  const week = cells[weekIdx];
  if (!Array.isArray(week) || week.length !== 7) return null;
  const cell = week[weekdayIdx];
  if (!cell || (cell.kind !== 'home' && cell.kind !== 'away')) return null;
  return cell;
}

function parseHHMM(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Parse an ISO `YYYY-MM-DD` and snap to that week's ISO Monday as a UTC Date.
 * ISO weekday: Mon=1..Sun=7. JS `getUTCDay`: Sun=0..Sat=6.
 */
function isoMondayOfISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  const jsDow = date.getUTCDay(); // 0=Sun..6=Sat
  const isoIdx = jsDow === 0 ? 6 : jsDow - 1; // 0=Mon..6=Sun
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - isoIdx,
    ),
  );
}

/**
 * Whole civil days from `epochMonday` (a UTC-midnight date carrying the epoch's
 * civil Y/M/D) to the household-local civil day of `instant`. Both sides are
 * projected to UTC-midnight calendar tokens so the subtraction is exact.
 */
function civilDaysBetween(epochMonday: Date, instant: Date, tz: string): number {
  const msPerDay = 86_400_000;
  const e = Date.UTC(
    epochMonday.getUTCFullYear(),
    epochMonday.getUTCMonth(),
    epochMonday.getUTCDate(),
  );
  const ymd = ymdInTz(instant, tz);
  const i = Date.UTC(ymd.year, ymd.month, ymd.day);
  return Math.floor((i - e) / msPerDay);
}
