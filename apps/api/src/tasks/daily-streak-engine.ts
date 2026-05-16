/**
 * Pure Daily-routine-streak primitives. The streak is per-Trackee; the
 * caller invokes these at day-rollover for each Trackee and persists the
 * resulting state.
 *
 *   classifyDay  — break / advance / non-event for a day's occurrences
 *   applyDay     — given the prior state + classification, returns the next
 *                  state and an optional bonus `earn` transaction
 *
 * Non-events preserve the counter (zero-task days, fully-suppressed days,
 * vacation days, etc.). The bonus only pays on qualifying advance.
 */

export type DayClassification = 'break' | 'advance' | 'non-event';

export interface DailyOccurrenceLike {
  /** Reminder occurrences don't count toward the streak in any direction. */
  isReminder: boolean;
  /**
   * End-of-day status. A day breaks the streak when
   * there is any unresolved Miss on a non-Reminder, non-Excused,
   * non-Deferred, non-Suppressed occurrence at rollover.
   */
  status: 'active' | 'excused' | 'deferred' | 'complete' | 'missed' | 'pending_review';
  presenceSuppressed?: boolean;
}

export interface DailyStreakState {
  count: number;
  lastQualifyingDay: string | null;
}

export interface BonusTxn {
  userId: string;
  amount: number;
  reason: string;
  day: string;
}

export interface ApplyContext {
  userId: string;
  day: string; // ISO 'YYYY-MM-DD'
  bonusAmount: number; // configurable; default 5
}

export interface ApplyResult {
  state: DailyStreakState;
  bonusTxn?: BonusTxn;
}

/**
 * Classify a day's occurrences into break / advance / non-event.
 *
 * A *break* happens when any non-reminder occurrence that isn't excused /
 * deferred / suppressed has an unresolved miss (status `active` past rollover
 * or `missed`) at end-of-day.
 *
 * A *qualifying advance* requires ≥1 non-reminder occurrence scheduled AND
 * every non-reminder, non-suppressed occurrence resolved (complete /
 * pending_review / excused / deferred).
 *
 * Everything else is a *non-event*.
 */
export function classifyDay(
  occurrencesForDay: DailyOccurrenceLike[],
): DayClassification {
  const nonReminders = occurrencesForDay.filter((o) => !o.isReminder);
  // Eligible = non-reminder occurrences that aren't excused/deferred/suppressed.
  const eligible = nonReminders.filter(
    (o) =>
      !o.presenceSuppressed && o.status !== 'excused' && o.status !== 'deferred',
  );

  const hasUnresolvedMiss = eligible.some(
    (o) => o.status === 'missed' || o.status === 'active',
  );
  if (hasUnresolvedMiss) return 'break';

  if (nonReminders.length === 0) return 'non-event';

  // Zero eligible (everything suppressed/excused/deferred) → non-event.
  if (eligible.length === 0) return 'non-event';

  // All eligible occurrences are resolved positively → advance.
  return 'advance';
}

/**
 * Apply a day's classification to the prior streak state.
 *
 *   advance   → count += 1, lastQualifyingDay = day, bonusTxn issued
 *   break     → count = 0, lastQualifyingDay unchanged
 *   non-event → count unchanged, lastQualifyingDay unchanged
 */
export function applyDay(
  prior: DailyStreakState,
  classification: DayClassification,
  context: ApplyContext,
): ApplyResult {
  if (classification === 'non-event') {
    return { state: prior };
  }
  if (classification === 'break') {
    return {
      state: { count: 0, lastQualifyingDay: prior.lastQualifyingDay },
    };
  }
  // advance — guard against re-processing the same day (the 5-minute rollover
  // window fires multiple times; lastQualifyingDay already set to today means
  // the bonus was already issued)
  if (prior.lastQualifyingDay === context.day) {
    return { state: prior };
  }
  const nextCount = prior.count + 1;
  const bonusTxn: BonusTxn | undefined =
    context.bonusAmount > 0
      ? {
          userId: context.userId,
          amount: context.bonusAmount,
          reason: 'daily routine streak',
          day: context.day,
        }
      : undefined;
  return {
    state: { count: nextCount, lastQualifyingDay: context.day },
    bonusTxn,
  };
}
