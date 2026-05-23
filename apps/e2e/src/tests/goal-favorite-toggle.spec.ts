import { test, expect } from '../fixtures';
import { TabletPage } from '../pages/tablet.page';
import { injectTabletToken } from '../fixtures/auth';

test('Trackee favorites a goal and filters the Favorites view to it', async ({
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

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await tablet.selectTrackee('Bob');
  await tablet.openView('Pick a goal');

  // Star Read a book.
  await tablet.toggleFavorite('Read a book');
  await expect(
    tablet.goalCard('Read a book').getByRole('button', {
      name: /remove from favorites/i,
    }),
  ).toBeVisible();

  // Pivot to Favorites; only the starred goal should be visible.
  await tablet.openFavoritesView();
  await expect(tablet.goalCard('Read a book')).toBeVisible();
  await expect(tablet.goalCard('Walk the dog')).toHaveCount(0);

  // Unstar from the Favorites view -> empty state.
  await tablet.toggleFavorite('Read a book');
  await expect(page.getByText(/no favorites yet/i)).toBeVisible();

  // Back to all goals -> both cards present, no stars filled.
  await tablet.backToAllGoals();
  await expect(tablet.goalCard('Walk the dog')).toBeVisible();
  await expect(tablet.goalCard('Read a book')).toBeVisible();
});
