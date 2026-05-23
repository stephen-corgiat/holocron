import { test, expect } from '../fixtures';
import { TabletPage } from '../pages/tablet.page';
import { injectTabletToken } from '../fixtures/auth';

test('Trackee marks a flat goal in-progress, sees it on Routine, then completes it', async ({
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

  await tablet.markInProgress('Walk the dog');
  // After marking, the card flips to the "In progress" badge.
  await expect(
    tablet.goalCard('Walk the dog').getByRole('button', {
      name: /clear in-progress/i,
    }),
  ).toBeVisible();

  // Switch to Routine; the in-progress strip should list the goal.
  await tablet.openView('Routine');
  await expect(tablet.inProgressCard('Walk the dog')).toBeVisible();

  // Complete from the strip.
  await tablet.completeInProgressGoal('Walk the dog');
  await expect(tablet.inProgressCard('Walk the dog')).toHaveCount(0);

  // Balance reflects the earn.
  await expect
    .poll(async () => {
      const b = await api.get<{ balance: number }>(
        `/transactions/trackee/${floor.trackeeUserId}/balance`,
        floor.adminToken,
      );
      return b.balance;
    })
    .toBe(7);
});

test('Marking past the in-progress cap auto-evicts the oldest', async ({
  page,
  api,
  floor,
  factories,
  clock,
}) => {
  await clock.set(new Date('2026-05-04T10:00:00.000Z'));

  // The in-progress list soft-caps at IN_PROGRESS_CAP (4): the cap-plus-one'th
  // mark evicts the oldest. Seed five goals so we can fill the cap then trip it.
  const names = ['Goal A', 'Goal B', 'Goal C', 'Goal D', 'Goal E'];
  const ids: Record<string, string> = {};
  for (const name of names) {
    const goal = await factories.createGoal({
      name,
      category_id: floor.categoryId,
      points: 1,
      completion_limit: 1,
      limit_window: 'week',
    });
    ids[name] = goal.id;
  }

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await tablet.selectTrackee('Bob');
  await tablet.openView('Pick a goal');

  // Fill the cap with A, B, C, D. Wait for each mark to land (the card flips to
  // "clear in-progress") before advancing the pinned clock, so every row gets a
  // distinct started_at and the eviction picks the genuine oldest.
  for (const name of ['Goal A', 'Goal B', 'Goal C', 'Goal D']) {
    await tablet.markInProgress(name);
    await expect(
      tablet.goalCard(name).getByRole('button', { name: /clear in-progress/i }),
    ).toBeVisible();
    await clock.advance(60_000);
  }

  // Pivot to Routine to confirm all four present, then back to Goals.
  await tablet.openView('Routine');
  await expect(tablet.inProgressCard('Goal A')).toBeVisible();
  await expect(tablet.inProgressCard('Goal B')).toBeVisible();
  await expect(tablet.inProgressCard('Goal C')).toBeVisible();
  await expect(tablet.inProgressCard('Goal D')).toBeVisible();

  // Mark a 5th — Goal A (oldest) should be evicted, holding the list at four.
  await tablet.openView('Pick a goal');
  await tablet.markInProgress('Goal E');

  // Verify via API to avoid UI flake: exactly four rows, A gone and E present.
  await expect
    .poll(async () => {
      const r = await api.get<{
        items: { goal_id: string; started_at: string }[];
      }>(`/goals/in-progress?user_id=${floor.trackeeUserId}`, floor.tabletToken);
      const goalIds = r.items.map((i) => i.goal_id);
      return {
        length: goalIds.length,
        hasA: goalIds.includes(ids['Goal A']),
        hasE: goalIds.includes(ids['Goal E']),
      };
    })
    .toEqual({ length: 4, hasA: false, hasE: true });

  // Goal A should not be in the in-progress list any more.
  await tablet.openView('Routine');
  await expect(tablet.inProgressCard('Goal A')).toHaveCount(0);
  await expect(tablet.inProgressCard('Goal E')).toBeVisible();
});

test('Clearing an in-progress goal removes it from Routine without completion', async ({
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

  await tablet.markInProgress('Walk the dog');
  await tablet.openView('Routine');
  await expect(tablet.inProgressCard('Walk the dog')).toBeVisible();

  await tablet.clearInProgressGoal('Walk the dog');
  await expect(tablet.inProgressCard('Walk the dog')).toHaveCount(0);

  // Balance unchanged.
  const b = await api.get<{ balance: number }>(
    `/transactions/trackee/${floor.trackeeUserId}/balance`,
    floor.adminToken,
  );
  expect(b.balance).toBe(0);
});
