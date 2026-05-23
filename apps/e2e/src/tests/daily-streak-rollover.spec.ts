import { test, expect } from '../fixtures';

/**
 * Scheduler idempotency: the production rollover timer fires every minute and
 * runs the day-rollover whenever the household-local time is within the first 5
 * minutes after midnight (a window, so a minute-0 tick delayed by an event-loop
 * stall or clock skew still rolls the day over). That means `rolloverDay` runs
 * up to 5 times for the same calendar day and must be safe to call repeatedly
 * without issuing duplicate bonuses or double-counting the streak.
 *
 * Asserting *exactly* one bonus pins down both directions: a missing guard
 * over-pays (the original bug — 5 bonuses), an over-eager guard pays nothing.
 */
test('streak rollover is idempotent: 5 ticks on the same day issue exactly one bonus', async ({
  api,
  floor,
  factories,
}) => {
  // `floor` seeds the clock at 09:00 on 2026-05-04. Rewind to just before
  // the task's due time so "Mark done" fires in-window on day 1.
  await api.post('/_e2e/clock/set', { iso: '2026-05-04T07:55:00.000Z' });

  await factories.createTask({
    kind: 'recurring',
    name: 'Test Task',
    due_time: '08:00',
    points: 1,
    assignee_ids: [floor.trackeeUserId],
  });

  // Complete the occurrence via the tablet API surface (as Bob).
  const { occurrences } = await api.get<{ occurrences: Array<{ id: string }> }>(
    `/occurrences/trackee/${floor.trackeeUserId}`,
    floor.tabletToken,
  );
  await api.post(`/occurrences/${occurrences[0].id}/complete`, undefined, floor.tabletToken);

  // Advance to just after midnight on day 2 — yesterday (day 1) is now the
  // day to be rolled over.
  await api.post('/_e2e/clock/set', { iso: '2026-05-05T00:01:00.000Z' });

  // Simulate the 5-minute rollover window: the scheduler fires once per minute.
  for (let i = 0; i < 5; i++) {
    await api.post('/_e2e/scheduler/tick', { which: 'streak' });
  }

  // Only one 'daily routine streak' earn should have been recorded.
  const { transactions } = await api.get<{
    transactions: Array<{ kind: string; reason: string | null }>;
  }>(`/transactions/trackee/${floor.trackeeUserId}/history`, floor.adminToken);

  const streakBonuses = transactions.filter(
    (t) => t.kind === 'earn' && t.reason === 'daily routine streak',
  );
  expect(streakBonuses).toHaveLength(1);
});
