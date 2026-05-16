/**
 * Pure Restriction merge engine (ADR-0004).
 *
 * A Restriction has a non-empty list of Causes; its `effective_*` lift
 * conditions are derived from those Causes via the two orthogonal-lift rules:
 *
 *   effective_expires_at = MAX of all Causes' `contributed_expires_at`,
 *     OR null if any Cause has `parent_only_on_expiry = true`.
 *
 *   effective_remediation_goals = UNION of all Causes' `contributed_remediation_goals`,
 *     OR empty if any Cause has `parent_only_on_remediation = true`.
 *
 * "Most-restrictive wins, per dimension, independently." Late completion of a
 * Miss removes just *that* Cause and recomputes — preserving the protection
 * the other Causes provide.
 *
 * No DB, no DI. The service wrapping this module handles persistence.
 */

export type RestrictionScope = 'internet' | 'entertainment' | 'games';
export type CauseKind = 'miss' | 'admin';

export interface RestrictionCauseInput {
  id?: string;
  kind: CauseKind;
  /** ISO instant (or Date). Null when this Cause contributes no expiry. */
  contributed_expires_at: Date | string | null;
  contributed_remediation_goals: string[] | null;
  parent_only_on_expiry: boolean;
  parent_only_on_remediation: boolean;
}

export interface RestrictionState {
  scope: RestrictionScope;
  user_id: string;
  causes: RestrictionCauseInput[];
  effective_expires_at: Date | null;
  effective_remediation_goals: string[];
}

/**
 * Recompute `effective_*` from the current Cause list. Pure.
 *
 * Returns `null` when `causes` is empty — signals the Restriction should be
 * lifted by the caller.
 */
export function recompute(
  scope: RestrictionScope,
  user_id: string,
  causes: RestrictionCauseInput[],
): RestrictionState | null {
  if (causes.length === 0) return null;

  const anyParentOnlyExpiry = causes.some((c) => c.parent_only_on_expiry);
  const anyParentOnlyRemediation = causes.some(
    (c) => c.parent_only_on_remediation,
  );

  let maxExpiry: Date | null = null;
  if (!anyParentOnlyExpiry) {
    for (const c of causes) {
      if (c.contributed_expires_at == null) continue;
      const t =
        c.contributed_expires_at instanceof Date
          ? c.contributed_expires_at
          : new Date(c.contributed_expires_at);
      if (maxExpiry === null || t.getTime() > maxExpiry.getTime()) {
        maxExpiry = t;
      }
    }
  }

  const remediation: string[] = [];
  if (!anyParentOnlyRemediation) {
    const seen = new Set<string>();
    for (const c of causes) {
      if (!c.contributed_remediation_goals) continue;
      for (const g of c.contributed_remediation_goals) {
        if (seen.has(g)) continue;
        seen.add(g);
        remediation.push(g);
      }
    }
  }

  return {
    scope,
    user_id,
    causes,
    effective_expires_at: maxExpiry,
    effective_remediation_goals: remediation,
  };
}

/**
 * Append a Cause and recompute `effective_*`. If `restriction` is null (no
 * active Restriction for this (user, scope)), creates one with the single
 * Cause.
 */
export function mergeCause(
  restriction: RestrictionState | null,
  user_id: string,
  scope: RestrictionScope,
  cause: RestrictionCauseInput,
): RestrictionState {
  const causes = restriction ? [...restriction.causes, cause] : [cause];
  const merged = recompute(scope, user_id, causes);
  if (!merged) {
    throw new Error(
      'restriction-merge.mergeCause: recompute returned null with a non-empty cause list',
    );
  }
  return merged;
}

/**
 * Remove a Cause by id and recompute. Returns `null` when the resulting
 * Cause list is empty — signals the caller should lift the Restriction.
 */
export function removeCause(
  restriction: RestrictionState,
  cause_id: string,
): RestrictionState | null {
  const remaining = restriction.causes.filter((c) => c.id !== cause_id);
  if (remaining.length === restriction.causes.length) {
    // No-op: the cause wasn't on this Restriction.
    return restriction;
  }
  return recompute(restriction.scope, restriction.user_id, remaining);
}
