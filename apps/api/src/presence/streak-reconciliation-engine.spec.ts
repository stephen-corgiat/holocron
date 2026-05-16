import {
  DayInput,
  ReconcileInput,
  reconcileStreak,
} from './streak-reconciliation-engine';

const BONUS = { amount: 10, reason: 'daily routine streak' };

function input(days: DayInput[], priorCount = 0): ReconcileInput {
  return {
    priorState: { count: priorCount, lastQualifyingDay: null },
    days,
    bonusAmount: BONUS.amount,
    bonusReason: BONUS.reason,
  };
}

describe('reconcileStreak — state transitions', () => {
  it('advance increments count + sets lastQualifyingDay', () => {
    const r = reconcileStreak(input([
      { day: '2026-05-15', classification: 'advance', existingBonusAmount: null },
    ]));
    expect(r.finalState).toEqual({ count: 1, lastQualifyingDay: '2026-05-15' });
  });

  it('break resets count, preserves lastQualifyingDay', () => {
    const r = reconcileStreak({
      priorState: { count: 5, lastQualifyingDay: '2026-05-10' },
      days: [{ day: '2026-05-15', classification: 'break', existingBonusAmount: null }],
      bonusAmount: BONUS.amount,
      bonusReason: BONUS.reason,
    });
    expect(r.finalState).toEqual({ count: 0, lastQualifyingDay: '2026-05-10' });
  });

  it('non-event preserves state entirely', () => {
    const r = reconcileStreak({
      priorState: { count: 5, lastQualifyingDay: '2026-05-10' },
      days: [{ day: '2026-05-15', classification: 'non-event', existingBonusAmount: null }],
      bonusAmount: BONUS.amount,
      bonusReason: BONUS.reason,
    });
    expect(r.finalState).toEqual({ count: 5, lastQualifyingDay: '2026-05-10' });
  });

  it('folds a multi-day sequence', () => {
    const r = reconcileStreak(input([
      { day: '2026-05-15', classification: 'advance', existingBonusAmount: null },
      { day: '2026-05-16', classification: 'advance', existingBonusAmount: null },
      { day: '2026-05-17', classification: 'break', existingBonusAmount: null },
      { day: '2026-05-18', classification: 'advance', existingBonusAmount: null },
    ]));
    expect(r.finalState).toEqual({ count: 1, lastQualifyingDay: '2026-05-18' });
  });
});

describe('reconcileStreak — transitions', () => {
  it('advance + no existing bonus → post_bonus', () => {
    const r = reconcileStreak(input([
      { day: '2026-05-15', classification: 'advance', existingBonusAmount: null },
    ]));
    expect(r.transitions).toEqual([
      { kind: 'post_bonus', day: '2026-05-15', amount: 10, reason: 'daily routine streak' },
    ]);
  });

  it('advance + existing bonus → no transition (idempotent)', () => {
    const r = reconcileStreak(input([
      { day: '2026-05-15', classification: 'advance', existingBonusAmount: 10 },
    ]));
    expect(r.transitions).toEqual([]);
  });

  it('break + existing bonus → reverse_bonus', () => {
    const r = reconcileStreak(input([
      { day: '2026-05-15', classification: 'break', existingBonusAmount: 10 },
    ]));
    expect(r.transitions).toEqual([
      {
        kind: 'reverse_bonus',
        day: '2026-05-15',
        amount: -10,
        reason: 'daily routine streak — reversed (presence change)',
      },
    ]);
  });

  it('non-event + existing bonus → reverse_bonus (e.g. now fully suppressed)', () => {
    const r = reconcileStreak(input([
      { day: '2026-05-15', classification: 'non-event', existingBonusAmount: 10 },
    ]));
    expect(r.transitions).toHaveLength(1);
    expect(r.transitions[0].kind).toBe('reverse_bonus');
  });

  it('break / non-event + no existing bonus → no transition', () => {
    const r = reconcileStreak(input([
      { day: '2026-05-15', classification: 'break', existingBonusAmount: null },
      { day: '2026-05-16', classification: 'non-event', existingBonusAmount: null },
    ]));
    expect(r.transitions).toEqual([]);
  });

  it('mixed sequence emits transitions per day independently', () => {
    const r = reconcileStreak(input([
      { day: '2026-05-15', classification: 'advance', existingBonusAmount: null },   // post
      { day: '2026-05-16', classification: 'advance', existingBonusAmount: 10 },     // no-op (already paid)
      { day: '2026-05-17', classification: 'break', existingBonusAmount: 10 },       // reverse
      { day: '2026-05-18', classification: 'non-event', existingBonusAmount: null }, // no-op
    ]));
    expect(r.transitions).toEqual([
      { kind: 'post_bonus', day: '2026-05-15', amount: 10, reason: 'daily routine streak' },
      {
        kind: 'reverse_bonus',
        day: '2026-05-17',
        amount: -10,
        reason: 'daily routine streak — reversed (presence change)',
      },
    ]);
  });

  it('bonusAmount=0 suppresses post_bonus even on advance', () => {
    const r = reconcileStreak({
      priorState: { count: 0, lastQualifyingDay: null },
      days: [{ day: '2026-05-15', classification: 'advance', existingBonusAmount: null }],
      bonusAmount: 0,
      bonusReason: 'streak',
    });
    expect(r.transitions).toEqual([]);
    // State still advances regardless of bonus.
    expect(r.finalState.count).toBe(1);
  });
});
