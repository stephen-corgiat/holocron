import { test, expect } from '../fixtures';
import { TabletPage } from '../pages/tablet.page';
import { injectTabletToken } from '../fixtures/auth';

test('Routine "Recently completed" teaser dedups by goal and re-adds to in-progress', async ({
  page,
  api,
  floor,
  factories,
  clock,
}) => {
  await clock.set(new Date('2026-05-04T10:00:00.000Z'));

  const a = await factories.createGoal({
    name: 'Goal A',
    category_id: floor.categoryId,
    points: 1,
    completion_limit: 5,
    limit_window: 'week',
  });
  const b = await factories.createGoal({
    name: 'Goal B',
    category_id: floor.categoryId,
    points: 1,
    completion_limit: 5,
    limit_window: 'week',
  });

  // Complete A twice and B once via the API so dedup is the only thing the
  // teaser has to do.
  await api.post(
    `/goals/${a.id}/complete`,
    { user_id: floor.trackeeUserId },
    floor.tabletToken,
  );
  await api.post(
    `/goals/${a.id}/complete`,
    { user_id: floor.trackeeUserId },
    floor.tabletToken,
  );
  await api.post(
    `/goals/${b.id}/complete`,
    { user_id: floor.trackeeUserId },
    floor.tabletToken,
  );

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await tablet.selectTrackee('Bob');

  // Routine teaser should list B (latest) and A — deduped, no duplicate A.
  await expect(tablet.recentlyCompletedRow('Goal B')).toBeVisible();
  await expect(tablet.recentlyCompletedRow('Goal A')).toBeVisible();
  await expect(page.locator('.tb-recent-row')).toHaveCount(2);

  // Tap "+" on Goal A — should add it to in-progress.
  await tablet.pickRecentlyCompletedAgain('Goal A');
  await expect(tablet.inProgressCard('Goal A')).toBeVisible();
});
