/**
 * Pure escalation-ladder primitives. No DI, no DB, no side effects. The
 * Miss-engine consumes these to compute the next position and the payload to
 * apply for a Miss; callers persist the result.
 *
 * Domain note: `Tier.points` is a non-negative magnitude — the deduction
 * itself is applied negatively elsewhere. The last Tier is the "and beyond"
 * terminal: once the position reaches the last index, further misses repeat
 * its payload without advancing the position further (per GLOSSARY.md).
 */

/**
 * A tier's Restriction spec. `type` is the router scope (see GLOSSARY.md
 * §Restrictions); `duration_minutes` and `remediation_goal_ids` are the two
 * lift dimensions a MissCause contributes (ADR-0004). When omitted on a
 * dimension, that dimension is "parent-only" — i.e., this Cause does not
 * relax the requirement for an Admin lift on that dimension.
 *
 * Carries `null` for either field to mean "explicit none, contribute parent-
 * only on this dimension"; `undefined` is treated the same.
 */
export interface RestrictionSpec {
  type: 'internet' | 'entertainment' | 'games';
  duration_minutes?: number | null;
  remediation_goal_ids?: string[] | null;
}

export interface Tier {
  points: number;
  restriction: RestrictionSpec | null;
}

export type Ladder = Tier[];

export type LadderOutcome = 'miss' | 'clean';

export interface StepResult {
  position: number;
  payload: Tier;
}

/**
 * Advance the ladder for an outcome.
 *
 * For `miss`: returns the payload at the current position, then advances the
 * position by one — UNLESS the current position is the last tier, in which
 * case the payload is the last tier and the position stays put (the "and
 * beyond" semantics).
 *
 * For `clean`: this function is a no-op on position (clean-streak handling
 * lives outside the ladder primitive). It returns `position` unchanged and
 * the tier at that position as `payload` — callers usually ignore the
 * payload in this branch but the symmetric shape keeps the API simple.
 *
 * Positions are 1-indexed in the persisted shape (matches the GLOSSARY.md
 * language "Tier 1, Tier 2…"). Internally we clamp to the ladder's range.
 */
export function step(
  ladder: Ladder,
  position: number,
  outcome: LadderOutcome,
): StepResult {
  if (ladder.length === 0) {
    throw new Error('escalation-ladder.step: ladder must have at least one tier');
  }
  const lastIndex = ladder.length - 1;
  const idx = clampIndex(position - 1, lastIndex);
  const payload = ladder[idx];
  if (outcome === 'clean') {
    return { position: idx + 1, payload };
  }
  const nextIdx = idx === lastIndex ? lastIndex : idx + 1;
  return { position: nextIdx + 1, payload };
}

/** Reset the ladder position to Tier 1. */
export function reset(_position: number): number {
  return 1;
}

function clampIndex(idx: number, lastIndex: number): number {
  if (idx < 0) return 0;
  if (idx > lastIndex) return lastIndex;
  return idx;
}
