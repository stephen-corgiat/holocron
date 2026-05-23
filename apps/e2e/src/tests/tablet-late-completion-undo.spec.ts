import { test, expect } from '../fixtures';
import { TabletPage } from '../pages/tablet.page';
import { injectTabletToken } from '../fixtures/auth';
import { anchorClock, dueTimeUtc } from '../fixtures/wall-clock';

test('late completion fully undoes a fired Miss (ADR-0001)', async ({
  page,
  api,
  floor,
  factories,
  clock,
  enforcement,
}) => {
  const t0 = await anchorClock(clock, -5 * 60_000);
  const dueTime = dueTimeUtc(new Date(t0.getTime() + 5 * 60_000));

  await factories.createTask({
    name: 'Make bed',
    due_time: dueTime,
    points: 5,
    late_window_minutes: 240,
    ladder: [
      {
        points: 2,
        restriction: {
          type: 'internet',
          duration_minutes: 60,
          remediation_goal_ids: null,
        },
      },
    ],
    assignee_ids: [floor.trackeeUserId],
  });

  // Cross deadline → Miss fires.
  await clock.advance(10 * 60_000);
  await clock.tick('miss');
  await enforcement.resetLogs(); // Watch only the undo's enforcement.

  const after = await api.get<{ balance: number }>(
    `/transactions/trackee/${floor.trackeeUserId}/balance`,
    floor.adminToken,
  );
  expect(after.balance).toBe(-2);

  // Trackee completes the task late.
  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await tablet.selectTrackee('Bob');
  await expect(tablet.taskRow('Make bed')).toBeVisible();
  await tablet.lateComplete('Make bed');

  // Per ADR-0001 the penalty refunds (−2 → 0). No retroactive earn — a late
  // completion undoes the Miss, it doesn't pay out as if the task were on time.
  await expect.poll(async () => {
    const res = await api.get<{ balance: number }>(
      `/transactions/trackee/${floor.trackeeUserId}/balance`,
      floor.adminToken,
    );
    return res.balance;
  }).toBe(0);

  // The router was told to deactivate Bob's internet block. Enforcement is
  // dispatched post-commit (fire-and-forget), so poll the log rather than
  // reading it once — under full-suite load the del call can land a beat after
  // the balance settles.
  await expect
    .poll(async () => {
      const calls = await enforcement.routerLog();
      return calls.some(
        (c) => /\/del\?/.test(c.url) && /10\.0\.0\.42/.test(c.url),
      );
    })
    .toBe(true);

  // Lock badge clears in the UI via WS push.
  await tablet.waitForNoLockBadge('Bob');
});
