import {
  DailyOccurrenceLike,
  DailyStreakState,
  applyDay,
  classifyDay,
} from './daily-streak-engine';

const recurring = (
  status: DailyOccurrenceLike['status'],
  extra: Partial<DailyOccurrenceLike> = {},
): DailyOccurrenceLike => ({
  isReminder: false,
  status,
  ...extra,
});

const reminder = (
  status: DailyOccurrenceLike['status'],
): DailyOccurrenceLike => ({
  isReminder: true,
  status,
});

describe('daily-streak.classifyDay', () => {
  it('break: any non-reminder occurrence missed at end-of-day', () => {
    expect(classifyDay([recurring('complete'), recurring('missed')])).toBe('break');
  });

  it('break: an active (unresolved) non-reminder occurrence at rollover', () => {
    expect(classifyDay([recurring('active')])).toBe('break');
  });

  it('advance: all non-reminder occurrences complete', () => {
    expect(classifyDay([recurring('complete'), recurring('complete')])).toBe(
      'advance',
    );
  });

  it('advance: mix of complete + excused counts as fully resolved', () => {
    expect(classifyDay([recurring('complete'), recurring('excused')])).toBe(
      'advance',
    );
  });

  it('non-event: zero non-reminder occurrences scheduled', () => {
    expect(classifyDay([])).toBe('non-event');
    expect(classifyDay([reminder('complete')])).toBe('non-event');
  });

  it('non-event: every non-reminder is excused / deferred / suppressed', () => {
    expect(
      classifyDay([
        recurring('excused'),
        recurring('deferred'),
        recurring('active', { presenceSuppressed: true }),
      ]),
    ).toBe('non-event');
  });

  it('reminder misses do not break the streak', () => {
    expect(classifyDay([reminder('active'), recurring('complete')])).toBe(
      'advance',
    );
  });

  it('presence-suppressed occurrences are ignored for break checks', () => {
    expect(
      classifyDay([
        recurring('active', { presenceSuppressed: true }),
        recurring('complete'),
      ]),
    ).toBe('advance');
  });

  it('pending_review counts as resolved (optimistic-complete)', () => {
    expect(classifyDay([recurring('pending_review')])).toBe('advance');
  });
});

describe('daily-streak.applyDay', () => {
  const ctx = { userId: 'user-bob', day: '2026-05-15', bonusAmount: 10 };
  const prior: DailyStreakState = { count: 3, lastQualifyingDay: '2026-05-14' };

  it('non-event preserves the counter and emits no bonus', () => {
    const r = applyDay(prior, 'non-event', ctx);
    expect(r.state).toEqual(prior);
    expect(r.bonusTxn).toBeUndefined();
  });

  it('break resets count to 0 and emits no bonus', () => {
    const r = applyDay(prior, 'break', ctx);
    expect(r.state.count).toBe(0);
    expect(r.state.lastQualifyingDay).toBe('2026-05-14');
    expect(r.bonusTxn).toBeUndefined();
  });

  it('advance increments count, sets last_qualifying_day, and emits the bonus txn', () => {
    const r = applyDay(prior, 'advance', ctx);
    expect(r.state.count).toBe(4);
    expect(r.state.lastQualifyingDay).toBe('2026-05-15');
    expect(r.bonusTxn).toEqual({
      userId: 'user-bob',
      amount: 10,
      reason: 'daily routine streak',
      day: '2026-05-15',
    });
  });

  it('advance from a zero-streak starts the counter at 1', () => {
    const r = applyDay({ count: 0, lastQualifyingDay: null }, 'advance', ctx);
    expect(r.state.count).toBe(1);
    expect(r.bonusTxn?.amount).toBe(10);
  });

  it('does not emit a bonus when the configured amount is zero', () => {
    const r = applyDay(prior, 'advance', { ...ctx, bonusAmount: 0 });
    expect(r.state.count).toBe(4);
    expect(r.bonusTxn).toBeUndefined();
  });

  it('idempotent: re-running advance for an already-processed day emits no bonus and preserves state', () => {
    // Simulates the 5-minute rollover window calling rolloverDay multiple times
    // for the same calendar day. After the first call persists lastQualifyingDay,
    // subsequent calls must be no-ops.
    const alreadyProcessed: DailyStreakState = { count: 4, lastQualifyingDay: '2026-05-15' };
    const r = applyDay(alreadyProcessed, 'advance', ctx);
    expect(r.state).toEqual(alreadyProcessed);
    expect(r.bonusTxn).toBeUndefined();
  });
});
