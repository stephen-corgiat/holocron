import { test, expect } from '../fixtures';
import { TabletPage } from '../pages/tablet.page';
import { injectTabletToken } from '../fixtures/auth';

test('Trackee completes a flat-value goal from the tablet', async ({
  page,
  api,
  floor,
  factories,
  clock,
}) => {
  await clock.set(new Date('2026-05-04T10:00:00.000Z'));

  await factories.createGoal({
    name: 'Walk the dog',
    category_id: floor.categoryId,
    kind: 'flat',
    points: 7,
    completion_limit: 5,
    limit_window: 'week',
  });

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await tablet.selectTrackee('Bob');
  await tablet.openView('Pick a goal');

  await expect(tablet.goalCard('Walk the dog')).toBeVisible();
  await tablet.completeFlatGoal('Walk the dog');

  await expect.poll(async () => {
    const b = await api.get<{ balance: number }>(
      `/transactions/trackee/${floor.trackeeUserId}/balance`,
      floor.adminToken,
    );
    return b.balance;
  }).toBe(7);
});
