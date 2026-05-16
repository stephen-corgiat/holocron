/**
 * Pure Occurrence resolution engine (GLOSSARY — Occurrence resolution).
 *
 * Maps `(snapshot, intent, now) -> ResolutionResult`. No DB, no DI, no
 * randomness. The applier owns persistence; this module owns the decision
 * about what effects each intent produces against a given state.
 *
 * The Miss-engine decision is internalised here.
 * The `evaluate_deadline` intent runs `miss-engine.evaluate` against the
 * snapshot; `reject_review` does the same with status forced to `active`
 * (matches the prior `evaluateForRejection` semantics).
 */
import { evaluate, MissEvaluation } from './miss-engine';
import { Ladder, RestrictionSpec } from './escalation-ladder';
import {
  LedgerOp,
  OccurrenceSnapshot,
  ResolutionEffects,
  ResolutionIntent,
  ResolutionResult,
} from './types';
import { isoDateInTz } from '../../clock/tz';

export function resolve(
  snapshot: OccurrenceSnapshot,
  intent: ResolutionIntent,
  now: Date,
  tz: string,
): ResolutionResult {
  switch (intent.kind) {
    case 'mark_clean':
      return resolveMarkClean(snapshot);
    case 'submit_for_review':
      return resolveSubmitForReview(snapshot, now);
    case 'approve_review':
      return resolveApproveReview(snapshot);
    case 'reject_review':
      return resolveRejectReview(snapshot, intent.adminUserId, intent.isRestrictable, now);
    case 'late_complete':
      return resolveLateComplete(snapshot, now, tz);
    case 'excuse':
      return resolveExcuse(snapshot, intent.adminUserId);
    case 'defer':
      return resolveDefer(
        snapshot,
        intent.adminUserId,
        intent.deferredScheduledAt,
        now,
      );
    case 'evaluate_deadline':
      return resolveEvaluateDeadline(
        snapshot,
        intent.isRestrictable,
        intent.presenceSuppressed,
        now,
      );
  }
}

function resolveMarkClean(s: OccurrenceSnapshot): ResolutionResult {
  if (s.occurrence.status === 'complete' || s.occurrence.status === 'pending_review') {
    return { kind: 'noop', reason: `already ${s.occurrence.status}` };
  }
  if (s.task.kind !== 'recurring' && s.task.kind !== 'windowed') {
    return {
      kind: 'rejected',
      reason: 'only recurring/windowed-task occurrences can be marked complete via this endpoint',
    };
  }
  const ledger: LedgerOp[] = [];
  if (s.task.points > 0) {
    ledger.push({
      kind: 'earn',
      amount: s.task.points,
      reason: s.task.name,
    });
  }
  return ok({
    status: 'complete',
    pendingSince: null,
    ledger,
    ladder: 'clean_streak_advance',
  });
}

function resolveSubmitForReview(
  s: OccurrenceSnapshot,
  now: Date,
): ResolutionResult {
  if (s.occurrence.status === 'complete' || s.occurrence.status === 'pending_review') {
    return { kind: 'noop', reason: `already ${s.occurrence.status}` };
  }
  if (s.task.kind !== 'recurring' && s.task.kind !== 'windowed') {
    return {
      kind: 'rejected',
      reason: 'only recurring/windowed-task occurrences can be marked complete via this endpoint',
    };
  }
  const ledger: LedgerOp[] = [];
  if (s.task.points > 0) {
    ledger.push({
      kind: 'earn',
      amount: s.task.points,
      reason: s.task.name,
    });
  }
  return ok({
    status: 'pending_review',
    pendingSince: now,
    ledger,
  });
}

function resolveApproveReview(s: OccurrenceSnapshot): ResolutionResult {
  if (s.occurrence.status !== 'pending_review') {
    return {
      kind: 'rejected',
      reason: `occurrence is not in pending_review (status=${s.occurrence.status})`,
    };
  }
  return ok({
    status: 'complete',
    pendingSince: null,
    ledger: [],
    ladder: 'clean_streak_advance',
  });
}

function resolveRejectReview(
  s: OccurrenceSnapshot,
  adminUserId: string | null,
  isRestrictable: boolean,
  now: Date,
): ResolutionResult {
  if (s.occurrence.status !== 'pending_review') {
    return {
      kind: 'rejected',
      reason: `occurrence is not in pending_review (status=${s.occurrence.status})`,
    };
  }
  // Re-evaluate miss-engine *as if at rejection time* — force status='active'
  // and presenceSuppressed=false so the engine doesn't bail early on a
  // suppressed past-deadline pending occurrence.
  const evalResult = runMissEngine(s, { status: 'active', presenceSuppressed: false, isRestrictable, now });
  const ledger: LedgerOp[] = [];
  if (s.priorEarnTotal > 0) {
    ledger.push({
      kind: 'claw_back',
      amount: -s.priorEarnTotal,
      reason: `${s.task.name} — review rejected`,
      adminUserId,
    });
  }
  const effects: ResolutionEffects = {
    status: 'missed',
    pendingSince: null,
    ledger,
  };
  if (evalResult.kind === 'MissFired') {
    if (evalResult.effects.penalty.points > 0) {
      ledger.push({
        kind: 'penalty',
        amount: -evalResult.effects.penalty.points,
        reason: s.task.name,
      });
    }
    effects.ladder = { kind: 'advance_to', to: evalResult.effects.ladder_advance.to };
    if (evalResult.effects.restriction_cause) {
      effects.restriction = buildApplyRestriction(s, evalResult.effects.restriction_cause, now);
    }
  }
  return { kind: 'effects', effects };
}

function resolveLateComplete(
  s: OccurrenceSnapshot,
  now: Date,
  tz: string,
): ResolutionResult {
  if (s.occurrence.status !== 'missed') {
    return {
      kind: 'rejected',
      reason: `occurrence is not in 'missed' state (got '${s.occurrence.status}')`,
    };
  }
  if (s.task.kind !== 'recurring') {
    return {
      kind: 'rejected',
      reason: 'late-complete only applies to recurring-task occurrences',
    };
  }
  if (!s.task.allowLateCompletion) {
    return {
      kind: 'rejected',
      reason: `task ${s.task.id} does not allow late completion`,
    };
  }
  const closesAtMs = s.occurrence.scheduledAt.getTime() + s.task.lateWindowMinutes * 60_000;
  if (now.getTime() > closesAtMs) {
    return { kind: 'rejected', reason: 'late window has closed' };
  }
  const ledger: LedgerOp[] = [];
  if (s.priorPenaltyTotal < 0) {
    ledger.push({
      kind: 'claw_back',
      amount: -s.priorPenaltyTotal,
      reason: `${s.task.name} — late completed`,
    });
  }
  const effects: ResolutionEffects = {
    status: 'complete',
    pendingSince: null,
    ledger,
    ladder: 'retract_one',
    restriction: {
      direction: 'remove',
      lift: {
        mechanism: 'late_complete',
        filter: { kind: 'by_occurrence', occurrenceId: s.occurrence.id },
      },
    },
  };
  if (isPastDay(s.occurrence.scheduledAt, now, tz)) {
    effects.dailyStreak = 'late_complete_repair';
  }
  return { kind: 'effects', effects };
}

function resolveExcuse(
  s: OccurrenceSnapshot,
  adminUserId: string | null,
): ResolutionResult {
  if (s.occurrence.status === 'excused' || s.occurrence.status === 'deferred') {
    return { kind: 'noop', reason: `already ${s.occurrence.status}` };
  }
  const wasMissed = s.occurrence.status === 'missed';
  const ledger: LedgerOp[] = [];
  const effects: ResolutionEffects = {
    status: 'excused',
    pendingSince: null,
    ledger,
  };
  if (wasMissed) {
    if (s.priorPenaltyTotal < 0) {
      ledger.push({
        kind: 'claw_back',
        amount: -s.priorPenaltyTotal,
        reason: `${s.task.name} — excused`,
        adminUserId,
      });
    }
    effects.ladder = 'retract_one';
  }
  return { kind: 'effects', effects };
}

function resolveDefer(
  s: OccurrenceSnapshot,
  adminUserId: string | null,
  deferredScheduledAt: Date,
  now: Date,
): ResolutionResult {
  if (s.occurrence.status === 'excused' || s.occurrence.status === 'deferred') {
    return {
      kind: 'rejected',
      reason: `occurrence ${s.occurrence.id} is already ${s.occurrence.status}`,
    };
  }
  if (deferredScheduledAt.getTime() <= now.getTime()) {
    return { kind: 'rejected', reason: 'defer target must be in the future' };
  }
  const wasMissed = s.occurrence.status === 'missed';
  const ledger: LedgerOp[] = [];
  const effects: ResolutionEffects = {
    status: 'deferred',
    pendingSince: null,
    ledger,
    newOccurrence: {
      scheduledAt: deferredScheduledAt,
      deferredFromOccurrenceId: s.occurrence.id,
    },
  };
  if (wasMissed) {
    if (s.priorPenaltyTotal < 0) {
      ledger.push({
        kind: 'claw_back',
        amount: -s.priorPenaltyTotal,
        reason: `${s.task.name} — excused`,
        adminUserId,
      });
    }
    effects.ladder = 'retract_one';
  }
  return { kind: 'effects', effects };
}

function resolveEvaluateDeadline(
  s: OccurrenceSnapshot,
  isRestrictable: boolean,
  presenceSuppressed: boolean,
  now: Date,
): ResolutionResult {
  if (s.occurrence.status !== 'active') {
    return { kind: 'noop', reason: `cannot evaluate deadline on status=${s.occurrence.status}` };
  }
  const evalResult = runMissEngine(s, {
    status: 'active',
    presenceSuppressed,
    isRestrictable,
    now,
  });
  if (evalResult.kind !== 'MissFired') {
    return { kind: 'noop', reason: `miss-engine: ${evalResult.kind}` };
  }
  const ledger: LedgerOp[] = [];
  if (evalResult.effects.penalty.points > 0) {
    ledger.push({
      kind: 'penalty',
      amount: -evalResult.effects.penalty.points,
      reason: s.task.name,
    });
  }
  const effects: ResolutionEffects = {
    status: 'missed',
    pendingSince: null,
    ledger,
    ladder: { kind: 'advance_to', to: evalResult.effects.ladder_advance.to },
  };
  if (evalResult.effects.restriction_cause) {
    effects.restriction = buildApplyRestriction(s, evalResult.effects.restriction_cause, now);
  }
  return { kind: 'effects', effects };
}

/**
 * Bridge to the (now co-located) Miss-engine. Normalises the JSON ladder and
 * synthesises the `OccurrenceLike` the engine consumes from snapshot fields
 * + caller-supplied flags.
 */
function runMissEngine(
  s: OccurrenceSnapshot,
  ctx: { status: 'active'; presenceSuppressed: boolean; isRestrictable: boolean; now: Date },
): MissEvaluation {
  const ladder = normalizeLadder(s.task.ladder);
  const scheduledAt = s.occurrence.deadline ?? s.occurrence.scheduledAt;
  return evaluate(
    {
      id: s.occurrence.id,
      taskId: s.occurrence.taskId,
      userId: s.occurrence.userId,
      scheduledAt,
      status: ctx.status,
      presenceSuppressed: ctx.presenceSuppressed,
    },
    { now: ctx.now, ladder, position: s.ladderPosition, isRestrictable: ctx.isRestrictable },
  );
}

/**
 * Normalise a raw JSON `task.ladder` into the typed `Ladder` shape. Tolerant
 * of missing fields; defaults to a single 1-point tier when empty.
 */
export function normalizeLadder(raw: unknown): Ladder {
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((tier) => {
      const t = tier as {
        points?: number;
        restriction?: {
          type?: string;
          duration_minutes?: number | null;
          remediation_goal_ids?: string[] | null;
        } | null;
      };
      const r = t.restriction ?? null;
      const scope =
        r && (r.type === 'internet' || r.type === 'entertainment' || r.type === 'games')
          ? r.type
          : null;
      return {
        points: Number(t.points ?? 0),
        restriction: scope
          ? {
              type: scope,
              duration_minutes: r?.duration_minutes ?? null,
              remediation_goal_ids: r?.remediation_goal_ids ?? null,
            }
          : null,
      };
    });
  }
  return [{ points: 1, restriction: null }];
}

function buildApplyRestriction(
  s: OccurrenceSnapshot,
  spec: RestrictionSpec,
  now: Date,
): ResolutionEffects['restriction'] {
  const durationMin = spec.duration_minutes;
  const goals = spec.remediation_goal_ids;
  const expiry =
    durationMin != null && durationMin > 0
      ? new Date(now.getTime() + durationMin * 60_000)
      : null;
  return {
    direction: 'apply',
    cause: {
      user_id: s.occurrence.userId,
      scope: spec.type,
      occurrence_id: s.occurrence.id,
      contributed_expires_at: expiry,
      contributed_remediation_goals: goals && goals.length > 0 ? goals : null,
      parent_only_on_expiry: durationMin == null,
      parent_only_on_remediation: !goals || goals.length === 0,
    },
  };
}

function ok(effects: ResolutionEffects): ResolutionResult {
  return { kind: 'effects', effects };
}

/** Is the occurrence's household-local civil day before today's? */
function isPastDay(scheduledAt: Date, now: Date, tz: string): boolean {
  return isoDateInTz(scheduledAt, tz) < isoDateInTz(now, tz);
}
