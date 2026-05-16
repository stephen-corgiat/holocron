/**
 * Pure Miss-engine. Evaluates a single occurrence at its deadline tick and
 * returns a state outcome. Callers are responsible for applying the side
 * effects on `MissFired` — this module performs no DB writes and emits no
 * events.
 *
 * The state matrix (see GLOSSARY.md):
 *
 *   Suppressed   — presence-suppressed; treat like Excused for rule purposes
 *   Excused      — admin-excused or deferred; counter preserved
 *   Complete     — already completed (or pending review → optimistic complete)
 *   Pending      — deadline not yet reached
 *   MissFired    — deadline reached, occurrence still active → fire a Miss
 */

import { Ladder, RestrictionSpec, Tier, step } from './escalation-ladder';

export type OccurrenceStatusForMiss =
  | 'active'
  | 'excused'
  | 'deferred'
  | 'complete'
  | 'missed'
  | 'pending_review';

export interface OccurrenceLike {
  id: string;
  taskId: string;
  userId: string;
  scheduledAt: Date;
  status: OccurrenceStatusForMiss;
  /** Pre-derived. Caller computes from presence schedule. */
  presenceSuppressed?: boolean;
}

export interface EvaluationContext {
  now: Date;
  ladder: Ladder;
  /** Current ladder position for (task × Trackee). 1-indexed; default 1. */
  position: number;
  /** Whether the Trackee is `is_restrictable`. Affects Restriction payload only — ladder still advances. */
  isRestrictable: boolean;
}

export type MissEvaluation =
  | { kind: 'Suppressed' }
  | { kind: 'Excused' }
  | { kind: 'Complete' }
  | { kind: 'Pending' }
  | {
      kind: 'MissFired';
      effects: {
        penalty: { points: number };
        ladder_advance: { from: number; to: number; tier_payload: Tier };
        restriction_cause: RestrictionSpec | null;
        streak_break: true;
      };
    };

/**
 * Decide the outcome for an occurrence at the deadline tick.
 *
 * `Pending review` is treated as Complete here — points credit optimistically;
 * the rejection path re-runs the engine at rejection time.
 */
export function evaluate(
  occurrence: OccurrenceLike,
  context: EvaluationContext,
): MissEvaluation {
  if (occurrence.presenceSuppressed) return { kind: 'Suppressed' };
  if (occurrence.status === 'excused' || occurrence.status === 'deferred') {
    return { kind: 'Excused' };
  }
  if (occurrence.status === 'complete' || occurrence.status === 'pending_review') {
    return { kind: 'Complete' };
  }
  if (occurrence.status === 'missed') {
    // Already fired — idempotent re-evaluation reports Complete-ish ("nothing to do").
    return { kind: 'Complete' };
  }
  if (occurrence.scheduledAt.getTime() > context.now.getTime()) {
    return { kind: 'Pending' };
  }
  // Active and at/past deadline → fire a Miss.
  const result = step(context.ladder, context.position, 'miss');
  const restrictionPayload =
    context.isRestrictable && result.payload.restriction
      ? result.payload.restriction
      : null;
  return {
    kind: 'MissFired',
    effects: {
      penalty: { points: result.payload.points },
      ladder_advance: {
        from: context.position,
        to: result.position,
        tier_payload: result.payload,
      },
      restriction_cause: restrictionPayload,
      streak_break: true,
    },
  };
}
