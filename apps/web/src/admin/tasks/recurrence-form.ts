// Shared recurrence/ladder form helpers for the unified Task editor.
// The recurrence picker, its encode/decode, and the restriction options were
// previously copy-pasted across the recurring, windowed, and reminder admin
// sections; this is the single home now.
import { DayOfWeek, RecurrencePattern, RecurrencePreset } from '../../auth/api';
import { todayIsoInTz } from '../../lib/datetime';

/** The flat form-state mirror of every RecurrencePattern variant. */
export interface RecurrenceFields {
  preset: RecurrencePreset;
  days: Set<DayOfWeek>;
  n: number;
  day_of_month: number;
  month: number;
  day: number;
  ordinal: number;
  day_of_week: DayOfWeek;
  anchor: string; // YYYY-MM-DD
}

export function blankRecurrenceFields(tz: string): RecurrenceFields {
  return {
    preset: 'daily',
    days: new Set<DayOfWeek>([1]),
    n: 2,
    day_of_month: 1,
    month: 1,
    day: 1,
    ordinal: 1,
    day_of_week: 1,
    // Anchor defaults to "today" in the household civil zone (ADR-0007), not
    // the admin browser's own zone, so a fresh N-week/biweekly pattern lines
    // up with the same civil day the backend will schedule against.
    anchor: todayIsoInTz(tz),
  };
}

/** Decode a stored pattern (or null = daily) into editable form fields. */
export function recurrenceFieldsFrom(
  r: RecurrencePattern | null,
  tz: string,
): RecurrenceFields {
  const base = blankRecurrenceFields(tz);
  if (!r) return base;
  base.preset = r.preset;
  if (r.preset === 'weekly') base.days = new Set(r.days);
  else if (r.preset === 'biweekly') {
    base.days = new Set(r.days);
    base.anchor = r.anchor;
  } else if (r.preset === 'every_n_days') {
    base.n = r.n;
    base.anchor = r.anchor;
  } else if (r.preset === 'every_n_weeks') {
    base.n = r.n;
    base.days = new Set(r.days);
    base.anchor = r.anchor;
  } else if (r.preset === 'every_n_months') {
    base.n = r.n;
    base.day_of_month = r.day_of_month;
    base.anchor = r.anchor;
  } else if (r.preset === 'yearly_on_date') {
    base.month = r.month;
    base.day = r.day;
  } else if (r.preset === 'yearly_in_month') {
    base.month = r.month;
    base.ordinal = r.ordinal;
    base.day_of_week = r.day_of_week;
  }
  return base;
}

/** Encode editable form fields back into the wire RecurrencePattern. */
export function patternFrom(f: RecurrenceFields): RecurrencePattern {
  switch (f.preset) {
    case 'daily':
      return { preset: 'daily' };
    case 'weekdays':
      return { preset: 'weekdays' };
    case 'weekends':
      return { preset: 'weekends' };
    case 'weekly':
      return { preset: 'weekly', days: Array.from(f.days) };
    case 'biweekly':
      return { preset: 'biweekly', days: Array.from(f.days), anchor: f.anchor };
    case 'every_n_days':
      return { preset: 'every_n_days', n: f.n, anchor: f.anchor };
    case 'every_n_weeks':
      return {
        preset: 'every_n_weeks',
        n: f.n,
        days: Array.from(f.days),
        anchor: f.anchor,
      };
    case 'every_n_months':
      return {
        preset: 'every_n_months',
        n: f.n,
        day_of_month: f.day_of_month,
        anchor: f.anchor,
      };
    case 'yearly_on_date':
      return { preset: 'yearly_on_date', month: f.month, day: f.day };
    case 'yearly_in_month':
      return {
        preset: 'yearly_in_month',
        month: f.month,
        ordinal: f.ordinal,
        day_of_week: f.day_of_week,
      };
  }
}

export const ALL_PRESETS: Array<{ value: RecurrencePreset; label: string }> = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekends', label: 'Weekends' },
  { value: 'weekly', label: 'Weekly on…' },
  { value: 'biweekly', label: 'Biweekly on…' },
  { value: 'every_n_days', label: 'Every N days' },
  { value: 'every_n_weeks', label: 'Every N weeks on…' },
  { value: 'every_n_months', label: 'Every N months' },
  { value: 'yearly_on_date', label: 'Yearly on date' },
  { value: 'yearly_in_month', label: 'Yearly in month' },
];

export const DAY_LABELS: Record<DayOfWeek, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
};

export const ORDINAL_LABELS: Array<{ value: number; label: string }> = [
  { value: 1, label: '1st' },
  { value: 2, label: '2nd' },
  { value: 3, label: '3rd' },
  { value: 4, label: '4th' },
  { value: -1, label: 'Last' },
];

export const RESTRICTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'none', label: 'No restriction' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'games', label: 'Games' },
  { value: 'internet', label: 'All internet' },
];

export const presetUsesDays = (p: RecurrencePreset): boolean =>
  p === 'weekly' || p === 'biweekly' || p === 'every_n_weeks';
export const presetUsesAnchor = (p: RecurrencePreset): boolean =>
  p === 'biweekly' ||
  p === 'every_n_days' ||
  p === 'every_n_weeks' ||
  p === 'every_n_months';
export const presetUsesN = (p: RecurrencePreset): boolean =>
  p === 'every_n_days' || p === 'every_n_weeks' || p === 'every_n_months';

/** Short human summary for list rows, e.g. "weekly · Mon, Wed". */
export function recurrenceSummary(r: RecurrencePattern | null): string {
  if (!r) return 'daily';
  switch (r.preset) {
    case 'daily':
      return 'daily';
    case 'weekdays':
      return 'weekdays';
    case 'weekends':
      return 'weekends';
    case 'weekly':
      return `weekly · ${r.days.map((d) => DAY_LABELS[d]).join(', ')}`;
    case 'biweekly':
      return `biweekly · ${r.days.map((d) => DAY_LABELS[d]).join(', ')}`;
    case 'every_n_days':
      return `every ${r.n} days`;
    case 'every_n_weeks':
      return `every ${r.n} wks · ${r.days.map((d) => DAY_LABELS[d]).join(', ')}`;
    case 'every_n_months':
      return `every ${r.n} mo · day ${r.day_of_month}`;
    case 'yearly_on_date':
      return `yearly · ${r.month}/${r.day}`;
    case 'yearly_in_month':
      return `yearly · ${ORDINAL_LABELS.find((o) => o.value === r.ordinal)?.label ?? r.ordinal} ${DAY_LABELS[r.day_of_week]}`;
  }
}
