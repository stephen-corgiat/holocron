import { resolve as resolveTz } from './resolution-engine';
import { OccurrenceSnapshot, ResolutionIntent } from './types';

// Existing cases predate household-tz threading; UTC reproduces the prior
// late-complete day-comparison behavior. A dedicated household-tz case for
// `isPastDay` lives at the bottom of this file.
const resolve = (
  snapshot: OccurrenceSnapshot,
  intent: ResolutionIntent,
  now: Date,
  tz = 'UTC',
) => resolveTz(snapshot, intent, now, tz);

const DEFAULT_LADDER = [
  { points: 3, restriction: null },
  { points: 5, restriction: null },
];

function snap(overrides: {
  occurrence?: Partial<OccurrenceSnapshot['occurrence']>;
  task?: Partial<OccurrenceSnapshot['task']>;
  ladderPosition?: number;
  cleanStreakCount?: number;
  priorEarnTotal?: number;
  priorPenaltyTotal?: number;
}): OccurrenceSnapshot {
  return {
    occurrence: {
      id: 'occ-1',
      taskId: 'task-1',
      userId: 'u-bob',
      scheduledAt: new Date('2026-05-15T18:00:00Z'),
      status: 'active',
      pendingSince: null,
      ...(overrides.occurrence ?? {}),
    },
    task: {
      id: 'task-1',
      name: 'Test Task',
      kind: 'recurring',
      points: 5,
      requiresVerification: false,
      allowLateCompletion: false,
      lateWindowMinutes: 720,
      ladderResetThreshold: 3,
      ladder: DEFAULT_LADDER,
      ...(overrides.task ?? {}),
    },
    ladderPosition: overrides.ladderPosition ?? 1,
    cleanStreakCount: overrides.cleanStreakCount ?? 0,
    priorEarnTotal: overrides.priorEarnTotal ?? 0,
    priorPenaltyTotal: overrides.priorPenaltyTotal ?? 0,
  };
}

const NOW = new Date('2026-05-15T20:00:00Z');

describe('resolve — mark_clean', () => {
  it('posts earn + clean_streak_advance for an active occurrence', () => {
    const r = resolve(snap({}), { kind: 'mark_clean' }, NOW);
    expect(r.kind).toBe('effects');
    if (r.kind !== 'effects') return;
    expect(r.effects.status).toBe('complete');
    expect(r.effects.pendingSince).toBeNull();
    expect(r.effects.ledger).toEqual([
      { kind: 'earn', amount: 5, reason: 'Test Task' },
    ]);
    expect(r.effects.ladder).toBe('clean_streak_advance');
  });

  it('emits no ledger op when task.points is 0', () => {
    const r = resolve(snap({ task: { points: 0 } }), { kind: 'mark_clean' }, NOW);
    if (r.kind !== 'effects') throw new Error('expected effects');
    expect(r.effects.ledger).toEqual([]);
    expect(r.effects.ladder).toBe('clean_streak_advance');
  });

  it('noops when already complete', () => {
    const r = resolve(
      snap({ occurrence: { status: 'complete' } }),
      { kind: 'mark_clean' },
      NOW,
    );
    expect(r.kind).toBe('noop');
  });

  it('noops when already pending_review', () => {
    const r = resolve(
      snap({ occurrence: { status: 'pending_review' } }),
      { kind: 'mark_clean' },
      NOW,
    );
    expect(r.kind).toBe('noop');
  });

  it('rejects reminder tasks', () => {
    const r = resolve(snap({ task: { kind: 'reminder' } }), { kind: 'mark_clean' }, NOW);
    expect(r.kind).toBe('rejected');
  });
});

describe('resolve — submit_for_review', () => {
  it('flips to pending_review with optimistic earn and pendingSince=now', () => {
    const r = resolve(
      snap({ task: { requiresVerification: true } }),
      { kind: 'submit_for_review' },
      NOW,
    );
    if (r.kind !== 'effects') throw new Error('expected effects');
    expect(r.effects.status).toBe('pending_review');
    expect(r.effects.pendingSince).toEqual(NOW);
    expect(r.effects.ledger).toEqual([
      { kind: 'earn', amount: 5, reason: 'Test Task' },
    ]);
    expect(r.effects.ladder).toBeUndefined();
  });
});

describe('resolve — approve_review', () => {
  it('flips to complete and advances clean streak; no ledger', () => {
    const r = resolve(
      snap({ occurrence: { status: 'pending_review' } }),
      { kind: 'approve_review', adminUserId: 'u-alice' },
      NOW,
    );
    if (r.kind !== 'effects') throw new Error('expected effects');
    expect(r.effects.status).toBe('complete');
    expect(r.effects.pendingSince).toBeNull();
    expect(r.effects.ledger).toEqual([]);
    expect(r.effects.ladder).toBe('clean_streak_advance');
  });

  it('rejects when not in pending_review', () => {
    const r = resolve(
      snap({ occurrence: { status: 'active' } }),
      { kind: 'approve_review', adminUserId: 'u-alice' },
      NOW,
    );
    expect(r.kind).toBe('rejected');
  });
});

describe('resolve — reject_review', () => {
  // Default ladder: tier 1 = 3 points, no restriction. Engine evaluates
  // miss-engine internally; with status='active' forced and
  // presenceSuppressed=false, the past-deadline check fires → MissFired.
  const PAST_DEADLINE = new Date('2026-05-15T20:00:00Z'); // NOW = 20:00, scheduled = 18:00

  it('claws back the optimistic earn and applies miss effects', () => {
    const r = resolve(
      snap({
        occurrence: { status: 'pending_review' },
        priorEarnTotal: 5,
      }),
      { kind: 'reject_review', adminUserId: 'u-alice', isRestrictable: true },
      PAST_DEADLINE,
    );
    if (r.kind !== 'effects') throw new Error('expected effects');
    expect(r.effects.status).toBe('missed');
    expect(r.effects.ledger).toEqual([
      {
        kind: 'claw_back',
        amount: -5,
        reason: 'Test Task — review rejected',
        adminUserId: 'u-alice',
      },
      { kind: 'penalty', amount: -3, reason: 'Test Task' },
    ]);
    expect(r.effects.ladder).toEqual({ kind: 'advance_to', to: 2 });
  });

  it('applies restriction.apply when the tier carries a Restriction spec', () => {
    const r = resolve(
      snap({
        occurrence: { status: 'pending_review' },
        priorEarnTotal: 5,
        task: {
          ladder: [
            {
              points: 3,
              restriction: {
                type: 'internet',
                duration_minutes: 60,
                remediation_goal_ids: ['g-1'],
              },
            },
            { points: 5, restriction: null },
          ],
        },
      }),
      { kind: 'reject_review', adminUserId: null, isRestrictable: true },
      PAST_DEADLINE,
    );
    if (r.kind !== 'effects') throw new Error('expected effects');
    expect(r.effects.restriction).toEqual({
      direction: 'apply',
      cause: {
        user_id: 'u-bob',
        scope: 'internet',
        occurrence_id: 'occ-1',
        contributed_expires_at: new Date(PAST_DEADLINE.getTime() + 60 * 60_000),
        contributed_remediation_goals: ['g-1'],
        parent_only_on_expiry: false,
        parent_only_on_remediation: false,
      },
    });
  });

  it('still flips to missed when miss-engine returns non-MissFired (e.g. deadline not yet reached)', () => {
    // Reject *before* the scheduled deadline — miss-engine returns Pending.
    const BEFORE_DEADLINE = new Date('2026-05-15T17:00:00Z');
    const r = resolve(
      snap({
        occurrence: { status: 'pending_review' },
        priorEarnTotal: 5,
      }),
      { kind: 'reject_review', adminUserId: 'u-alice', isRestrictable: true },
      BEFORE_DEADLINE,
    );
    if (r.kind !== 'effects') throw new Error('expected effects');
    expect(r.effects.status).toBe('missed');
    expect(r.effects.ladder).toBeUndefined();
    expect(r.effects.ledger).toHaveLength(1); // only the claw_back
  });

  it('no claw_back when priorEarnTotal is 0', () => {
    const r = resolve(
      snap({ occurrence: { status: 'pending_review' }, priorEarnTotal: 0 }),
      { kind: 'reject_review', adminUserId: null, isRestrictable: true },
      PAST_DEADLINE,
    );
    if (r.kind !== 'effects') throw new Error('expected effects');
    expect(r.effects.ledger).toEqual([
      { kind: 'penalty', amount: -3, reason: 'Test Task' },
    ]);
  });
});

describe('resolve — late_complete', () => {
  const lateOcc = snap({
    occurrence: { status: 'missed', scheduledAt: new Date('2026-05-15T18:00:00Z') },
    task: { allowLateCompletion: true, lateWindowMinutes: 720 },
    priorPenaltyTotal: -3,
  });

  it('flips to complete + claw_back + retract_one + late_complete lift', () => {
    const r = resolve(lateOcc, { kind: 'late_complete' }, NOW);
    if (r.kind !== 'effects') throw new Error('expected effects');
    expect(r.effects.status).toBe('complete');
    expect(r.effects.ledger).toEqual([
      { kind: 'claw_back', amount: 3, reason: 'Test Task — late completed' },
    ]);
    expect(r.effects.ladder).toBe('retract_one');
    expect(r.effects.restriction).toEqual({
      direction: 'remove',
      lift: {
        mechanism: 'late_complete',
        filter: { kind: 'by_occurrence', occurrenceId: 'occ-1' },
      },
    });
  });

  it('rejects when not missed', () => {
    const r = resolve(
      snap({ occurrence: { status: 'active' }, task: { allowLateCompletion: true } }),
      { kind: 'late_complete' },
      NOW,
    );
    expect(r.kind).toBe('rejected');
  });

  it('rejects when allowLateCompletion is false', () => {
    const r = resolve(
      snap({ occurrence: { status: 'missed' } }),
      { kind: 'late_complete' },
      NOW,
    );
    expect(r.kind).toBe('rejected');
  });

  it('rejects when past the late window', () => {
    const r = resolve(
      lateOcc,
      { kind: 'late_complete' },
      new Date('2026-05-16T06:01:00Z'), // 18:00 + 720min = 06:00 next day
    );
    expect(r.kind).toBe('rejected');
  });

  it('rejects windowed tasks', () => {
    const r = resolve(
      snap({
        occurrence: { status: 'missed' },
        task: { kind: 'windowed', allowLateCompletion: true },
      }),
      { kind: 'late_complete' },
      NOW,
    );
    expect(r.kind).toBe('rejected');
  });

  it('sets dailyStreak=late_complete_repair when scheduledAt is in a past day', () => {
    const r = resolve(
      snap({
        occurrence: {
          status: 'missed',
          scheduledAt: new Date('2026-05-14T18:00:00Z'),
        },
        task: { allowLateCompletion: true, lateWindowMinutes: 60 * 48 },
        priorPenaltyTotal: -3,
      }),
      { kind: 'late_complete' },
      new Date('2026-05-15T10:00:00Z'),
    );
    if (r.kind !== 'effects') throw new Error('expected effects');
    expect(r.effects.dailyStreak).toBe('late_complete_repair');
  });

  it('no dailyStreak effect when same-day', () => {
    const r = resolve(lateOcc, { kind: 'late_complete' }, NOW);
    if (r.kind !== 'effects') throw new Error('expected effects');
    expect(r.effects.dailyStreak).toBeUndefined();
  });
});

describe('resolve — excuse', () => {
  it('flips to excused without ledger/ladder for an active occurrence', () => {
    const r = resolve(snap({}), { kind: 'excuse', adminUserId: 'u-alice' }, NOW);
    if (r.kind !== 'effects') throw new Error('expected effects');
    expect(r.effects.status).toBe('excused');
    expect(r.effects.ledger).toEqual([]);
    expect(r.effects.ladder).toBeUndefined();
  });

  it('reverses miss effects when status was missed', () => {
    const r = resolve(
      snap({ occurrence: { status: 'missed' }, priorPenaltyTotal: -3 }),
      { kind: 'excuse', adminUserId: 'u-alice' },
      NOW,
    );
    if (r.kind !== 'effects') throw new Error('expected effects');
    expect(r.effects.ledger).toEqual([
      {
        kind: 'claw_back',
        amount: 3,
        reason: 'Test Task — excused',
        adminUserId: 'u-alice',
      },
    ]);
    expect(r.effects.ladder).toBe('retract_one');
  });

  it('noops when already excused', () => {
    const r = resolve(
      snap({ occurrence: { status: 'excused' } }),
      { kind: 'excuse', adminUserId: null },
      NOW,
    );
    expect(r.kind).toBe('noop');
  });
});

describe('resolve — defer', () => {
  const future = new Date('2026-05-20T18:00:00Z');

  it('flips to deferred and emits a newOccurrence spec', () => {
    const r = resolve(
      snap({}),
      { kind: 'defer', adminUserId: 'u-alice', deferredScheduledAt: future },
      NOW,
    );
    if (r.kind !== 'effects') throw new Error('expected effects');
    expect(r.effects.status).toBe('deferred');
    expect(r.effects.newOccurrence).toEqual({
      scheduledAt: future,
      deferredFromOccurrenceId: 'occ-1',
    });
    expect(r.effects.ledger).toEqual([]);
  });

  it('reverses miss effects when status was missed', () => {
    const r = resolve(
      snap({ occurrence: { status: 'missed' }, priorPenaltyTotal: -3 }),
      { kind: 'defer', adminUserId: 'u-alice', deferredScheduledAt: future },
      NOW,
    );
    if (r.kind !== 'effects') throw new Error('expected effects');
    expect(r.effects.ledger).toEqual([
      {
        kind: 'claw_back',
        amount: 3,
        reason: 'Test Task — excused',
        adminUserId: 'u-alice',
      },
    ]);
    expect(r.effects.ladder).toBe('retract_one');
  });

  it('rejects when already excused', () => {
    const r = resolve(
      snap({ occurrence: { status: 'excused' } }),
      { kind: 'defer', adminUserId: null, deferredScheduledAt: future },
      NOW,
    );
    expect(r.kind).toBe('rejected');
  });

  it('rejects when target is in the past', () => {
    const r = resolve(
      snap({}),
      {
        kind: 'defer',
        adminUserId: null,
        deferredScheduledAt: new Date('2026-05-14T18:00:00Z'),
      },
      NOW,
    );
    expect(r.kind).toBe('rejected');
  });
});

describe('resolve — evaluate_deadline', () => {
  // Default snap: scheduledAt = 18:00, NOW = 20:00 → past-deadline.
  // Default ladder: tier 1 = 3 points, no restriction.

  it('flips to missed + posts penalty + advances ladder when past-deadline', () => {
    const r = resolve(
      snap({}),
      { kind: 'evaluate_deadline', isRestrictable: true, presenceSuppressed: false },
      NOW,
    );
    if (r.kind !== 'effects') throw new Error('expected effects');
    expect(r.effects.status).toBe('missed');
    expect(r.effects.ledger).toEqual([
      { kind: 'penalty', amount: -3, reason: 'Test Task' },
    ]);
    expect(r.effects.ladder).toEqual({ kind: 'advance_to', to: 2 });
    expect(r.effects.restriction).toBeUndefined();
  });

  it('emits restriction.apply when the tier carries a Restriction spec (auto-expiry)', () => {
    const r = resolve(
      snap({
        task: {
          ladder: [
            {
              points: 3,
              restriction: { type: 'games', duration_minutes: 30, remediation_goal_ids: null },
            },
            { points: 5, restriction: null },
          ],
        },
      }),
      { kind: 'evaluate_deadline', isRestrictable: true, presenceSuppressed: false },
      NOW,
    );
    if (r.kind !== 'effects') throw new Error('expected effects');
    expect(r.effects.restriction).toEqual({
      direction: 'apply',
      cause: {
        user_id: 'u-bob',
        scope: 'games',
        occurrence_id: 'occ-1',
        contributed_expires_at: new Date(NOW.getTime() + 30 * 60_000),
        contributed_remediation_goals: null,
        parent_only_on_expiry: false,
        parent_only_on_remediation: true,
      },
    });
  });

  it('emits parent-only-on-expiry cause when duration is null', () => {
    const r = resolve(
      snap({
        task: {
          ladder: [
            {
              points: 3,
              restriction: {
                type: 'internet',
                duration_minutes: null,
                remediation_goal_ids: ['g-1', 'g-2'],
              },
            },
            { points: 5, restriction: null },
          ],
        },
      }),
      { kind: 'evaluate_deadline', isRestrictable: true, presenceSuppressed: false },
      NOW,
    );
    if (r.kind !== 'effects') throw new Error('expected effects');
    if (!r.effects.restriction || r.effects.restriction.direction !== 'apply') {
      throw new Error('expected restriction.apply');
    }
    expect(r.effects.restriction.cause.parent_only_on_expiry).toBe(true);
    expect(r.effects.restriction.cause.contributed_expires_at).toBeNull();
    expect(r.effects.restriction.cause.contributed_remediation_goals).toEqual(['g-1', 'g-2']);
  });

  it('skips restriction.apply when Trackee is non-Restrictable (GLOSSARY)', () => {
    const r = resolve(
      snap({
        task: {
          ladder: [
            { points: 3, restriction: { type: 'games', duration_minutes: 30 } },
            { points: 5, restriction: null },
          ],
        },
      }),
      { kind: 'evaluate_deadline', isRestrictable: false, presenceSuppressed: false },
      NOW,
    );
    if (r.kind !== 'effects') throw new Error('expected effects');
    expect(r.effects.ladder).toEqual({ kind: 'advance_to', to: 2 });
    expect(r.effects.restriction).toBeUndefined();
  });

  it('noops on an already-missed occurrence (idempotent)', () => {
    const r = resolve(
      snap({ occurrence: { status: 'missed' } }),
      { kind: 'evaluate_deadline', isRestrictable: true, presenceSuppressed: false },
      NOW,
    );
    expect(r.kind).toBe('noop');
  });

  it('noops when presence-suppressed', () => {
    const r = resolve(
      snap({}),
      { kind: 'evaluate_deadline', isRestrictable: true, presenceSuppressed: true },
      NOW,
    );
    expect(r.kind).toBe('noop');
  });

  it('noops when deadline not yet reached', () => {
    const r = resolve(
      snap({}),
      { kind: 'evaluate_deadline', isRestrictable: true, presenceSuppressed: false },
      new Date('2026-05-15T17:00:00Z'), // before scheduledAt 18:00
    );
    expect(r.kind).toBe('noop');
  });

  it('no penalty ledger op when tier points is 0', () => {
    const r = resolve(
      snap({ task: { ladder: [{ points: 0, restriction: null }] } }),
      { kind: 'evaluate_deadline', isRestrictable: true, presenceSuppressed: false },
      NOW,
    );
    if (r.kind !== 'effects') throw new Error('expected effects');
    expect(r.effects.ledger).toEqual([]);
  });

  it('uses occurrence.deadline (window_end) when set, not scheduledAt', () => {
    // Windowed task: scheduledAt is window_start (early), deadline is window_end (later).
    const r = resolve(
      snap({
        occurrence: {
          scheduledAt: new Date('2026-05-15T10:00:00Z'),
          deadline: new Date('2026-05-15T22:00:00Z'),
        },
        task: { kind: 'windowed' },
      }),
      { kind: 'evaluate_deadline', isRestrictable: true, presenceSuppressed: false },
      NOW, // 20:00 — before window_end → no miss
    );
    expect(r.kind).toBe('noop');
  });
});
