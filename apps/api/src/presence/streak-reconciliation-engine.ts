/**
 * Pure Daily-routine-streak reconciliation engine.
 *
 * When a Trackee's Presence schedule is edited retroactively, the
 * orchestrating `PresenceReconciliationService` walks the affected day range
 * and for each day asks this engine: given the new classification and the
 * existing streak-bonus row (if any), what should change?
 *
 * The engine decides the *transitions* (post a bonus, reverse a stale bonus)
 * and the resulting Trackee streak state. The applier handles persistence:
 * insert the ledger rows, save the streak state. No DI, no DB.
 *
 * Decision rules (GLOSSARY — Daily routine streak):
 *
 *   advance + no existing bonus → post_bonus
 *   advance + existing bonus    → no-op (bonus already paid)
 *   break + existing bonus      → reverse_bonus (the day no longer qualifies)
 *   break + no existing bonus   → no-op
 *   non-event + existing bonus  → reverse_bonus (e.g. fully suppressed now)
 *   non-event + no existing bonus → no-op
 *
 * State transition mirrors `daily-streak-engine.applyDay`:
 *   advance  → count + 1, lastQualifyingDay = day
 *   break    → count = 0,  lastQualifyingDay unchanged
 *   non-event → state unchanged
 */
import { DayClassification } from '../tasks/daily-streak-engine';

export interface StreakState {
  count: number;
  lastQualifyingDay: string | null;
}

export interface DayInput {
  /** ISO 'YYYY-MM-DD'. */
  day: string;
  classification: DayClassification;
  /** Amount of the existing streak-bonus `earn` row for this day, or null. */
  existingBonusAmount: number | null;
}

export type StreakTransition =
  | { kind: 'post_bonus'; day: string; amount: number; reason: string }
  | { kind: 'reverse_bonus'; day: string; amount: number; reason: string };

export interface ReconcileInput {
  priorState: StreakState;
  days: DayInput[];
  bonusAmount: number;
  bonusReason: string;
}

export interface ReconcileResult {
  finalState: StreakState;
  transitions: StreakTransition[];
}

export function reconcileStreak(input: ReconcileInput): ReconcileResult {
  let state = input.priorState;
  const transitions: StreakTransition[] = [];

  for (const d of input.days) {
    state = nextState(state, d.classification, d.day);

    const hasBonus = d.existingBonusAmount !== null;
    const shouldHaveBonus =
      d.classification === 'advance' && input.bonusAmount > 0;

    if (shouldHaveBonus && !hasBonus) {
      transitions.push({
        kind: 'post_bonus',
        day: d.day,
        amount: input.bonusAmount,
        reason: input.bonusReason,
      });
    } else if (!shouldHaveBonus && hasBonus) {
      transitions.push({
        kind: 'reverse_bonus',
        day: d.day,
        amount: -(d.existingBonusAmount as number),
        reason: `${input.bonusReason} — reversed (presence change)`,
      });
    }
  }

  return { finalState: state, transitions };
}

function nextState(
  prior: StreakState,
  classification: DayClassification,
  day: string,
): StreakState {
  if (classification === 'non-event') return prior;
  if (classification === 'break') {
    return { count: 0, lastQualifyingDay: prior.lastQualifyingDay };
  }
  return { count: prior.count + 1, lastQualifyingDay: day };
}
