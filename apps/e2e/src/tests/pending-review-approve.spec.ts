import { test, expect } from '../fixtures';
import { TabletPage } from '../pages/tablet.page';
import { AdminPendingReviewPage } from '../pages/admin-pending-review.page';
import { injectAdminToken, injectTabletToken } from '../fixtures/auth';

test('verifiable completion → pending → admin approve → permanent credit', async ({
  page,
  api,
  floor,
  factories,
  clock,
}) => {
  await clock.set(new Date('2026-05-04T07:55:00.000Z'));
  await factories.generateOccurrences();

  await factories.createTask({
    name: 'Practice piano',
    due_time: '08:00',
    points: 8,
    requires_verification: true,
    assignee_ids: [floor.trackeeUserId],
  });

  // Trackee marks the verifiable task done on the tablet.
  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await tablet.selectTrackee('Bob');
  await tablet.markComplete('Practice piano');

  // Optimistic credit already applied (+8).
  await expect.poll(async () => {
    const b = await api.get<{ balance: number }>(
      `/transactions/trackee/${floor.trackeeUserId}/balance`,
      floor.adminToken,
    );
    return b.balance;
  }).toBe(8);

  // Admin approves from the Pending review queue.
  await injectAdminToken(page, floor);
  const pending = new AdminPendingReviewPage(page);
  await pending.goto();
  await pending.expectRow('Practice piano');
  await pending.approve('Practice piano');
  await pending.expectNoRow('Practice piano');

  // Balance unchanged (no claw_back, no further earn).
  const b = await api.get<{ balance: number }>(
    `/transactions/trackee/${floor.trackeeUserId}/balance`,
    floor.adminToken,
  );
  expect(b.balance).toBe(8);
});
