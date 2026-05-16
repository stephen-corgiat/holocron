/**
 * Occurrence resolution types (GLOSSARY — Occurrence resolution).
 *
 * The Resolution engine consumes an `OccurrenceSnapshot` + a
 * `ResolutionIntent` describing the caller's action and returns a
 * `ResolutionResult` — either a coarse `ResolutionEffects` bucket to apply,
 * a `noop` (intent is idempotent for this state), or a `rejected` (intent
 * is illegal for this state — e.g. late-complete past the late window).
 *
 * Engine is pure. The applier (`ResolutionService`) loads snapshot, calls
 * engine, opens one DB transaction, applies effects, then post-commit fires
 * the restriction apply/remove + event fan-out.
 *
 * The engine absorbs the Miss-engine decision: callers no
 * longer pass pre-computed `MissFiredEffects`. The `evaluate_deadline` and
 * `reject_review` intents internally call the (now co-located) miss-engine
 * via the engine snapshot + intent-supplied flags.
 */
import { OccurrenceStatus } from '../occurrence.entity';
import { TransactionKind } from '../../transactions/transaction.entity';
import {
  ApplyLiftInput,
  CauseFilter,
  LiftMechanism,
} from '../../restrictions/lift';
import { MissCauseInput } from '../../restrictions/restrictions.service';

/**
 * Sufficient state for the engine to decide every intent. Loaded by the
 * applier from repos before calling `resolve`. Numeric "counter" fields
 * default to their fresh values (position=1, cleanStreakCount=0) when no row
 * exists, so the engine never special-cases absence.
 *
 * `task.ladder` is the raw JSON column; the engine normalises into the typed
 * `Ladder` shape via `escalation-ladder.normalizeLadder`.
 */
export interface OccurrenceSnapshot {
  occurrence: {
    id: string;
    taskId: string;
    userId: string;
    scheduledAt: Date;
    /**
     * For windowed tasks this is the deadline (window_end). For recurring
     * tasks the engine uses `scheduledAt` for both schedule and deadline.
     * The applier sets this when relevant; otherwise leave undefined.
     */
    deadline?: Date;
    status: OccurrenceStatus;
    pendingSince: Date | null;
  };
  task: {
    id: string;
    name: string;
    kind: 'recurring' | 'windowed' | 'reminder';
    points: number;
    requiresVerification: boolean;
    allowLateCompletion: boolean;
    lateWindowMinutes: number;
    ladderResetThreshold: number;
    /** Raw ladder JSON; engine normalises internally. */
    ladder: unknown;
  };
  ladderPosition: number;
  cleanStreakCount: number;
  /** Sum of prior `earn` transaction amounts for this occurrence (≥ 0). */
  priorEarnTotal: number;
  /** Sum of prior `penalty` transaction amounts for this occurrence (≤ 0). */
  priorPenaltyTotal: number;
}

export type ResolutionIntent =
  | { kind: 'mark_clean' }
  | { kind: 'submit_for_review' }
  | { kind: 'approve_review'; adminUserId: string }
  | {
      kind: 'reject_review';
      adminUserId: string | null;
      isRestrictable: boolean;
    }
  | { kind: 'late_complete' }
  | { kind: 'excuse'; adminUserId: string | null }
  | {
      kind: 'defer';
      adminUserId: string | null;
      deferredScheduledAt: Date;
    }
  | {
      /**
       * Deadline-tick evaluation. Engine internally runs the Miss-engine and
       * returns Miss effects on `MissFired`, otherwise `noop`. Used by the
       * scheduled deadline-tick sweep and by presence reconciliation's
       * retro-miss path.
       */
      kind: 'evaluate_deadline';
      isRestrictable: boolean;
      presenceSuppressed: boolean;
    };

export interface LedgerOp {
  kind: TransactionKind;
  /** Signed; engine computes the final value. */
  amount: number;
  reason: string;
  adminUserId?: string | null;
}

export type LadderEffect =
  | 'clean_streak_advance'
  | 'retract_one'
  | { kind: 'advance_to'; to: number };

export type RestrictionEffect =
  | { direction: 'apply'; cause: MissCauseInput }
  | { direction: 'remove'; lift: ApplyLiftInput };

/**
 * Coarse effect buckets matching GLOSSARY vocabulary. Applier walks each
 * present field in a fixed order (status → ledger → ladder → restriction →
 * dailyStreak → newOccurrence). All ledger rows in one call share a single
 * `txn_group_id` minted by the applier.
 */
export interface ResolutionEffects {
  status: OccurrenceStatus;
  pendingSince: Date | null;
  ledger: LedgerOp[];
  ladder?: LadderEffect;
  restriction?: RestrictionEffect;
  dailyStreak?: 'late_complete_repair';
  newOccurrence?: { scheduledAt: Date; deferredFromOccurrenceId: string };
}

export type ResolutionResult =
  | { kind: 'effects'; effects: ResolutionEffects }
  | { kind: 'noop'; reason: string }
  | { kind: 'rejected'; reason: string };

// Re-export Lift filter shapes for engine consumers.
export type { ApplyLiftInput, CauseFilter, LiftMechanism, MissCauseInput };
