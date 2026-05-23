import { test, expect } from '../fixtures';
import { TabletPage } from '../pages/tablet.page';
import { AdminPendingReviewPage } from '../pages/admin-pending-review.page';
import { injectAdminToken, injectTabletToken } from '../fixtures/auth';
import { anchorClock, dueTimeUtc } from '../fixtures/wall-clock';

test('verifiable completion → pending → admin reject → claw-back + Miss fires', async ({
  page,
  api,
  floor,
  factories,
  clock,
}) => {
  // Anchor the fake clock (and the pinned browser clock) to a fixed mid-day
  // instant so the tablet's Date.now() matches the API's FakeClock. Deadline
  // 5 min before the anchor so the reject path can fire the Miss (it evaluates
  // `now > scheduled_at`).
  const t0 = await anchorClock(clock);
  const dueTime = dueTimeUtc(new Date(t0.getTime() - 5 * 60_000));

  await factories.createTask({
    name: 'Tidy room',
    due_time: dueTime,
    points: 6,
    requires_verification: true,
    ladder: [{ points: 3, restriction: null }],
    assignee_ids: [floor.trackeeUserId],
  });

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await tablet.selectTrackee('Bob');
  await tablet.markComplete('Tidy room');

  // Optimistic +6.
  await expect.poll(async () => {
    const b = await api.get<{ balance: number }>(
      `/transactions/trackee/${floor.trackeeUserId}/balance`,
      floor.adminToken,
    );
    return b.balance;
  }).toBe(6);

  await injectAdminToken(page, floor);
  const pending = new AdminPendingReviewPage(page);
  await pending.goto();
  await pending.reject('Tidy room');
  await pending.expectNoRow('Tidy room');

  // Claw-back (-6) + penalty (-3) → -3 net.
  const b = await api.get<{ balance: number }>(
    `/transactions/trackee/${floor.trackeeUserId}/balance`,
    floor.adminToken,
  );
  expect(b.balance).toBe(-3);

  const history = await api.get<{
    transactions: Array<{ kind: string; amount: number }>;
  }>(
    `/transactions/trackee/${floor.trackeeUserId}/history`,
    floor.adminToken,
  );
  const kinds = history.transactions.map((t) => t.kind);
  expect(kinds).toContain('earn');
  expect(kinds).toContain('claw_back');
  expect(kinds).toContain('penalty');
});
