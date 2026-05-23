import { test, expect } from '../fixtures';
import { TabletPage } from '../pages/tablet.page';
import { injectTabletToken } from '../fixtures/auth';

test('Trackee filters the goal catalog with the search input', async ({
  page,
  floor,
  factories,
  clock,
}) => {
  await clock.set(new Date('2026-05-04T10:00:00.000Z'));

  await factories.createGoal({
    name: 'Walk the dog',
    category_id: floor.categoryId,
    points: 5,
    completion_limit: 1,
    limit_window: 'week',
  });
  await factories.createGoal({
    name: 'Read a book',
    category_id: floor.categoryId,
    points: 5,
    completion_limit: 1,
    limit_window: 'week',
  });
  await factories.createGoal({
    name: 'Tidy your room',
    category_id: floor.categoryId,
    points: 5,
    completion_limit: 1,
    limit_window: 'week',
  });

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await tablet.selectTrackee('Bob');
  await tablet.openView('Pick a goal');

  await expect(tablet.goalCard('Walk the dog')).toBeVisible();
  await expect(tablet.goalCard('Read a book')).toBeVisible();
  await expect(tablet.goalCard('Tidy your room')).toBeVisible();

  await tablet.searchGoals('book');
  await expect(tablet.goalCard('Read a book')).toBeVisible();
  await expect(tablet.goalCard('Walk the dog')).toHaveCount(0);
  await expect(tablet.goalCard('Tidy your room')).toHaveCount(0);

  await tablet.searchGoals('');
  await expect(tablet.goalCard('Walk the dog')).toBeVisible();
  await expect(tablet.goalCard('Tidy your room')).toBeVisible();
});
