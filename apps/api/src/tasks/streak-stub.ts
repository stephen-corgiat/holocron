import { OccurrenceEntity } from './occurrence.entity';
import { TaskEntity } from './task.entity';

export type OccurrenceWithTask = OccurrenceEntity & { task: TaskEntity };

/**
 * Minimal stand-ins for the streak / audible-warning rules, used by tests to
 * assert the "reminder occurrences are excluded from all of these" rule by
 * example — the contract
 * each future module must honor is that `filterStreakEligible` strips
 * `kind === 'reminder'`, full stop.
 */
export function filterStreakEligible(
  occurrences: OccurrenceWithTask[],
): OccurrenceWithTask[] {
  return occurrences.filter((o) => o.task.kind !== 'reminder');
}

export function dailyRoutineStreakAdvances(
  occurrences: OccurrenceWithTask[],
): boolean {
  const eligible = filterStreakEligible(occurrences);
  if (eligible.length === 0) return false; // zero non-reminder tasks ⇒ non-event
  return eligible.every(
    (o) => o.status === 'complete' || o.status === 'excused',
  );
}

export function cleanStreakAdvances(occurrence: OccurrenceWithTask): boolean {
  if (occurrence.task.kind === 'reminder') return false;
  return occurrence.status === 'complete' || occurrence.status === 'excused';
}

export function audibleWarningContributes(
  occurrence: OccurrenceWithTask,
): boolean {
  if (occurrence.task.kind === 'reminder') return false;
  return occurrence.status === 'active';
}
