import { test, expect } from '../fixtures';
import { TabletPage } from '../pages/tablet.page';
import { injectTabletToken } from '../fixtures/auth';

test('Trackee completes a task on the tablet and balance ticks up', async ({
  page,
  api,
  floor,
  factories,
  clock,
}) => {
  // Stable wall-clock time — set just before the task's due time so the
  // "Mark done" affordance is the one that shows (not "Late").
  await clock.set(new Date('2026-05-04T07:55:00.000Z'));
  // Re-seed today's occurrences against the now-set clock.
  await factories.generateOccurrences();

  await factories.createTask({
    name: 'Make bed',
    due_time: '08:00',
    points: 5,
    assignee_ids: [floor.trackeeUserId],
  });

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await tablet.selectTrackee('Bob');

  await expect(tablet.taskRow('Make bed')).toBeVisible();
  await tablet.markComplete('Make bed');

  await expect(tablet.taskRow('Make bed')).toHaveClass(/is-done/);
  await expect(page.locator('.tb-points-chip')).toContainText(/5\s*PTS/);

  // Cross-check via API: balance is 5 and the earn row is present.
  const balanceRes = await api.get<{ balance: number }>(
    `/transactions/trackee/${floor.trackeeUserId}/balance`,
    floor.adminToken,
  );
  expect(balanceRes.balance).toBe(5);
  const history = await api.get<{
    transactions: Array<{ amount: number; kind: string }>;
  }>(
    `/transactions/trackee/${floor.trackeeUserId}/history`,
    floor.adminToken,
  );
  expect(history.transactions.some((t) => t.kind === 'earn' && t.amount === 5)).toBe(true);
});
