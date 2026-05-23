import { test, expect } from '../fixtures';
import { TabletPage } from '../pages/tablet.page';
import { injectTabletToken } from '../fixtures/auth';

test('Trackee completes a tiered goal at the chosen tier', async ({
  page,
  api,
  floor,
  factories,
  clock,
}) => {
  await clock.set(new Date('2026-05-04T10:00:00.000Z'));

  await factories.createGoal({
    name: 'Read a book',
    category_id: floor.categoryId,
    kind: 'tiered',
    tier_values: [10, 20, 30, 40, 50],
    completion_limit: 5,
    limit_window: 'week',
  });

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await tablet.selectTrackee('Bob');
  await tablet.openView('Pick a goal');

  await expect(tablet.goalCard('Read a book')).toBeVisible();
  await tablet.pickGoalTier('Read a book', 30);

  await expect.poll(async () => {
    const b = await api.get<{ balance: number }>(
      `/transactions/trackee/${floor.trackeeUserId}/balance`,
      floor.adminToken,
    );
    return b.balance;
  }).toBe(30);
});
