/**
 * GLOSSARY — Lift mechanism. The four canonical mechanisms by which a
 * Restriction can be removed. Mirrors the enumeration in GLOSSARY.md.
 */
export type LiftMechanism =
  | 'admin'
  | 'auto_expiry'
  | 'goal_remediation'
  | 'late_complete';

/**
 * How to select which Causes to remove. Independent of mechanism so callers
 * can compose (e.g. a hypothetical "admin lift these specific causes" path).
 *
 * - `all_for_restriction` — every Cause on the named Restriction.
 * - `by_occurrence` — every Cause whose `occurrenceId` matches; may span
 *   multiple Restrictions when an Occurrence's Tier specified more than one
 *   scope.
 * - `by_cause_ids` — explicit Cause id list.
 */
export type CauseFilter =
  | { kind: 'all_for_restriction'; restrictionId: string }
  | { kind: 'by_occurrence'; occurrenceId: string }
  | { kind: 'by_cause_ids'; causeIds: string[] };

export interface ApplyLiftInput {
  mechanism: LiftMechanism;
  filter: CauseFilter;
}

export interface LiftResult {
  /** Restrictions whose Cause list was modified (may not be fully lifted). */
  touchedRestrictionIds: string[];
  /** Restrictions whose Cause list emptied and were marked `lifted_at`. */
  liftedRestrictionIds: string[];
}
