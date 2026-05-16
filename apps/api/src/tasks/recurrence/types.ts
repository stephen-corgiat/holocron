// Recurrence engine — pure, dep-free types. No Nest / TypeORM imports.
// The DB persists `pattern` as JSONB on `tasks.recurrence`; the engine
// expands it into a sequence of (date) tuples for a given range.

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // Sunday = 0
export type MonthOfYear =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12;
export type WeekdayOrdinal = 1 | 2 | 3 | 4 | 5 | -1; // -1 = last

export type RecurrencePattern =
  | { preset: 'daily' }
  | { preset: 'weekdays' }
  | { preset: 'weekends' }
  | { preset: 'weekly'; days: DayOfWeek[] }
  | { preset: 'biweekly'; days: DayOfWeek[]; anchor: string } // 'YYYY-MM-DD'
  | { preset: 'every_n_days'; n: number; anchor: string }
  | { preset: 'every_n_weeks'; n: number; days: DayOfWeek[]; anchor: string }
  | { preset: 'every_n_months'; n: number; day_of_month: number; anchor: string }
  | { preset: 'yearly_on_date'; month: MonthOfYear; day: number }
  | {
      preset: 'yearly_in_month';
      month: MonthOfYear;
      ordinal: WeekdayOrdinal;
      day_of_week: DayOfWeek;
    };

export interface DateRange {
  // Both ends inclusive, in calendar-day terms. Time-of-day is ignored —
  // the engine works in pure calendar dates (the Occurrence's wall-clock
  // time-of-day is layered on by the caller via the task's `due_time`).
  from: Date;
  to: Date;
}

export interface Occurrence {
  // The local calendar date the pattern fires on, at midnight local time.
  // The caller combines this with the task's `due_time` to build the
  // persisted occurrence row.
  date: Date;
}
