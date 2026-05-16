import { Ladder } from './escalation-ladder';
import { OccurrenceLike, evaluate } from './miss-engine';

const now = new Date('2026-05-15T20:00:00Z');
const past = new Date('2026-05-15T08:00:00Z');
const future = new Date('2026-05-15T22:00:00Z');

const baseLadder: Ladder = [
  { points: 1, restriction: null },
  { points: 5, restriction: { type: 'entertainment' } },
  { points: 10, restriction: { type: 'internet' } },
];

const occ = (overrides: Partial<OccurrenceLike> = {}): OccurrenceLike => ({
  id: 'occ-1',
  taskId: 'task-1',
  userId: 'user-bob',
  scheduledAt: past,
  status: 'active',
  ...overrides,
});

describe('miss-engine.evaluate — state matrix', () => {
  it('Suppressed when presence-suppressed (takes precedence over status)', () => {
    const r = evaluate(occ({ presenceSuppressed: true }), {
      now,
      ladder: baseLadder,
      position: 1,
      isRestrictable: true,
    });
    expect(r.kind).toBe('Suppressed');
  });

  it('Excused for excused status', () => {
    const r = evaluate(occ({ status: 'excused' }), {
      now,
      ladder: baseLadder,
      position: 1,
      isRestrictable: true,
    });
    expect(r.kind).toBe('Excused');
  });

  it('Excused for deferred status', () => {
    const r = evaluate(occ({ status: 'deferred' }), {
      now,
      ladder: baseLadder,
      position: 1,
      isRestrictable: true,
    });
    expect(r.kind).toBe('Excused');
  });

  it('Complete for complete status', () => {
    const r = evaluate(occ({ status: 'complete' }), {
      now,
      ladder: baseLadder,
      position: 1,
      isRestrictable: true,
    });
    expect(r.kind).toBe('Complete');
  });

  it('Complete for pending_review status (optimistic-complete window)', () => {
    const r = evaluate(occ({ status: 'pending_review' }), {
      now,
      ladder: baseLadder,
      position: 1,
      isRestrictable: true,
    });
    expect(r.kind).toBe('Complete');
  });

  it('Pending for an active occurrence whose deadline has not arrived', () => {
    const r = evaluate(occ({ scheduledAt: future }), {
      now,
      ladder: baseLadder,
      position: 1,
      isRestrictable: true,
    });
    expect(r.kind).toBe('Pending');
  });

  it('MissFired for an active occurrence past its deadline', () => {
    const r = evaluate(occ(), {
      now,
      ladder: baseLadder,
      position: 1,
      isRestrictable: true,
    });
    expect(r.kind).toBe('MissFired');
    if (r.kind !== 'MissFired') throw new Error('unreachable');
    expect(r.effects.penalty.points).toBe(1);
    expect(r.effects.ladder_advance.from).toBe(1);
    expect(r.effects.ladder_advance.to).toBe(2);
    expect(r.effects.restriction_cause).toBeNull();
    expect(r.effects.streak_break).toBe(true);
  });

  it('MissFired emits a Restriction Cause when the Trackee is restrictable AND the tier has a restriction', () => {
    const r = evaluate(occ(), {
      now,
      ladder: baseLadder,
      position: 2,
      isRestrictable: true,
    });
    if (r.kind !== 'MissFired') throw new Error('unreachable');
    expect(r.effects.restriction_cause).toEqual({ type: 'entertainment' });
    expect(r.effects.ladder_advance.to).toBe(3);
  });

  it('MissFired skips the Restriction for a non-Restrictable Trackee, but still advances the ladder', () => {
    // Alice is the canonical non-Restrictable Admin trackee.
    const r = evaluate(occ({ userId: 'user-alice' }), {
      now,
      ladder: baseLadder,
      position: 2,
      isRestrictable: false,
    });
    if (r.kind !== 'MissFired') throw new Error('unreachable');
    expect(r.effects.restriction_cause).toBeNull();
    expect(r.effects.ladder_advance.from).toBe(2);
    expect(r.effects.ladder_advance.to).toBe(3);
    expect(r.effects.penalty.points).toBe(5);
  });

  it('MissFired at the terminal tier repeats the tier payload without advancing', () => {
    const r = evaluate(occ(), {
      now,
      ladder: baseLadder,
      position: 3,
      isRestrictable: true,
    });
    if (r.kind !== 'MissFired') throw new Error('unreachable');
    expect(r.effects.penalty.points).toBe(10);
    expect(r.effects.ladder_advance.from).toBe(3);
    expect(r.effects.ladder_advance.to).toBe(3);
  });

  it('treats an already-missed occurrence as a no-op (Complete-ish)', () => {
    const r = evaluate(occ({ status: 'missed' }), {
      now,
      ladder: baseLadder,
      position: 1,
      isRestrictable: true,
    });
    expect(r.kind).toBe('Complete');
  });
});
