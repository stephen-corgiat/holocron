import { test, expect } from '../fixtures';
import { TabletPage } from '../pages/tablet.page';
import { injectTabletToken } from '../fixtures/auth';
import { anchorClock, dueTimeUtc } from '../fixtures/wall-clock';

test('a missed task fires the four-effect Miss + creates a Restriction', async ({
  page,
  api,
  floor,
  factories,
  clock,
  enforcement,
}) => {
  // Anchor the fake clock (and the pinned browser clock) to a fixed mid-day
  // instant so the tablet's local Date.now() computations (late_complete_until
  // countdown etc.) stay in sync. t0 is 5 min before the anchor; the task is
  // due at the anchor itself.
  const t0 = await anchorClock(clock, -5 * 60_000); // anchor − 5 min
  const dueTime = dueTimeUtc(new Date(t0.getTime() + 5 * 60_000)); // the anchor

  await factories.createTask({
    name: 'Brush teeth',
    due_time: dueTime,
    points: 5,
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

  await enforcement.resetLogs();

  // Cross the deadline and trigger the miss tick.
  await clock.advance(10 * 60_000);
  await clock.tick('miss');

  // Penalty transaction posted.
  const balanceRes = await api.get<{ balance: number }>(
    `/transactions/trackee/${floor.trackeeUserId}/balance`,
    floor.adminToken,
  );
  expect(balanceRes.balance).toBe(-2);

  // Router was hit on the `internet` scope (add) for Bob's enrolled device.
  const routerCalls = await enforcement.routerLog();
  expect(routerCalls.length).toBeGreaterThan(0);
  expect(
    routerCalls.some(
      (c) =>
        /internet/.test(c.url) && /\/add\?/.test(c.url) && /10\.0\.0\.42/.test(c.url),
    ),
  ).toBe(true);

  // Tablet view: Bob's tab carries the lock badge.
  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await tablet.waitForLockBadge('Bob');
});
