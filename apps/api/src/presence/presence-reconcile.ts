/**
 * Pure reconciliation engine (ADR-0003). Compares the previous Presence
 * schedule to the next one for a single Trackee and emits an ordered list
 * of events for an orchestrator to apply.
 *
 * The engine is pure — it performs no DB writes, posts no transactions,
 * fires no events. Tests cover it directly.
 *
 * Events:
 *
 *   LedgerReversal  — an occurrence that previously fired a Miss is now
 *                     presence-suppressed; the penalty (and per-day-streak
 *                     bonus if applicable) must be clawed back, the ladder
 *                     retracted, and streak counters restored.
 *   MissFire        — an occurrence that was previously suppressed is no
 *                     longer suppressed and is past-deadline; the Miss-engine
 *                     must fire its four-effect tuple as-if at `now`.
 *   StreakRecompute — the affected Trackee's daily-streak counters need a
 *                     re-derivation from history for the affected days.
 */

import type { OneOffWindow } from './presence.entity';
import { isSuppressed, PresenceScheduleLike } from './presence-resolver';
import { isoDateInTz } from '../clock/tz';

export type ReconcileOccurrenceStatus =
  | 'active'
  | 'excused'
  | 'deferred'
  | 'complete'
  | 'missed'
  | 'pending_review';

export interface ReconcileOccurrence {
  id: string;
  taskId: string;
  userId: string;
  /** Effective deadline instant (already combined with `task.due_time`). */
  scheduledAt: Date;
  status: ReconcileOccurrenceStatus;
}

export type ReconcileEvent =
  | {
      kind: 'LedgerReversal';
      occurrenceId: string;
      userId: string;
      taskId: string;
    }
  | { kind: 'MissFire'; occurrenceId: string; userId: string; taskId: string }
  | { kind: 'StreakRecompute'; userId: string; days: string[] };

export interface ReconcileInput {
  oldSchedule: PresenceScheduleLike;
  newSchedule: PresenceScheduleLike;
  occurrences: ReconcileOccurrence[];
  now: Date;
  /** Household time zone for day-bucketing + suppression evaluation. */
  tz: string;
}

export function reconcile(input: ReconcileInput): ReconcileEvent[] {
  const events: ReconcileEvent[] = [];
  const affectedDays = new Set<string>();
  const affectedUsers = new Set<string>();

  for (const occ of input.occurrences) {
    const oldSup = isSuppressed(input.oldSchedule, occ.scheduledAt, input.tz);
    const newSup = isSuppressed(input.newSchedule, occ.scheduledAt, input.tz);
    if (oldSup === newSup) continue;

    affectedDays.add(isoDateInTz(occ.scheduledAt, input.tz));
    affectedUsers.add(occ.userId);

    if (newSup) {
      // Newly suppressed: undo any previously-fired Miss effects. An
      // occurrence that's still active (deadline not reached, or already
      // resolved positively) needs no ledger reversal — only `missed` does.
      if (occ.status === 'missed') {
        events.push({
          kind: 'LedgerReversal',
          occurrenceId: occ.id,
          userId: occ.userId,
          taskId: occ.taskId,
        });
      }
    } else {
      // No longer suppressed: an active occurrence past deadline must fire
      // its Miss now. Already-completed / excused / deferred / pending /
      // missed occurrences don't need a fresh fire — the Miss either
      // already fired (missed) or the resolution still stands.
      if (
        occ.status === 'active' &&
        occ.scheduledAt.getTime() <= input.now.getTime()
      ) {
        events.push({
          kind: 'MissFire',
          occurrenceId: occ.id,
          userId: occ.userId,
          taskId: occ.taskId,
        });
      }
    }
  }

  for (const userId of affectedUsers) {
    events.push({
      kind: 'StreakRecompute',
      userId,
      days: [...affectedDays].sort(),
    });
  }

  return events;
}

/**
 * Bounded date range over which a schedule diff can affect suppression.
 * Vacation-window changes bound the range to the union of added/removed
 * windows. Recurring-rule / grid / epoch changes are open-ended (the diff
 * can in principle affect any past date) — the caller must supply a
 * conservative window in that case.
 */
export function affectedDateRange(
  oldSchedule: PresenceScheduleLike,
  newSchedule: PresenceScheduleLike,
): { start: string; end: string } | null {
  const diff = diffWindows(
    oldSchedule.oneOffWindows ?? [],
    newSchedule.oneOffWindows ?? [],
  );
  const ruleChanged = recurringRuleChanged(oldSchedule, newSchedule);

  if (diff.length === 0 && !ruleChanged) return null;

  const dates: string[] = [];
  for (const w of diff) {
    dates.push(w.start, w.end);
  }
  if (ruleChanged && dates.length === 0) {
    // No vacation diff but the recurring rule changed: caller passes an
    // explicit fallback range (e.g. trailing 90 days). We surface `null`
    // to signal "open-ended" and let the caller decide bounds.
    return null;
  }
  dates.sort();
  return { start: dates[0], end: dates[dates.length - 1] };
}

function diffWindows(
  oldWs: OneOffWindow[],
  newWs: OneOffWindow[],
): OneOffWindow[] {
  const key = (w: OneOffWindow) => `${w.start}|${w.end}|${w.label}`;
  const oldKeys = new Set(oldWs.map(key));
  const newKeys = new Set(newWs.map(key));
  const out: OneOffWindow[] = [];
  for (const w of newWs) if (!oldKeys.has(key(w))) out.push(w);
  for (const w of oldWs) if (!newKeys.has(key(w))) out.push(w);
  return out;
}

function recurringRuleChanged(
  a: PresenceScheduleLike,
  b: PresenceScheduleLike,
): boolean {
  if (a.recurringRuleKind !== b.recurringRuleKind) return true;
  if ((a.gridNWeeks ?? null) !== (b.gridNWeeks ?? null)) return true;
  if ((a.epochDate ?? null) !== (b.epochDate ?? null)) return true;
  return JSON.stringify(a.gridCells ?? null) !== JSON.stringify(b.gridCells ?? null);
}
