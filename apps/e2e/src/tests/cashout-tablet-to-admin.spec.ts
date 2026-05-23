import { test, expect } from '../fixtures';
import { TabletPage } from '../pages/tablet.page';
import { AdminCashOutQueuePage } from '../pages/admin-cashout.page';
import { injectAdminToken, injectTabletToken } from '../fixtures/auth';

test('positive balance: tablet requests cash-out → admin commits → withdrawal lands', async ({
  page,
  api,
  floor,
  factories,
  clock,
}) => {
  await clock.set(new Date('2026-05-04T10:00:00.000Z'));
  await factories.adjustBalance({
    user_id: floor.trackeeUserId,
    amount: 25,
    reason: 'seed balance',
  });

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await tablet.selectTrackee('Bob');
  await tablet.openView('Points');
  await tablet.openCashOutDialog();
  await tablet.submitCashOut(10);

  await injectAdminToken(page, floor);
  const queue = new AdminCashOutQueuePage(page);
  await queue.goto();
  await queue.expectRow('Bob');
  await queue.commit('Bob');
  await queue.expectEmpty();

  const balance = await api.get<{ balance: number }>(
    `/transactions/trackee/${floor.trackeeUserId}/balance`,
    floor.adminToken,
  );
  expect(balance.balance).toBe(15);

  const history = await api.get<{
    transactions: Array<{ kind: string; amount: number; admin_user_id: string | null }>;
  }>(
    `/transactions/trackee/${floor.trackeeUserId}/history`,
    floor.adminToken,
  );
  const withdrawal = history.transactions.find((t) => t.kind === 'withdrawal');
  expect(withdrawal).toBeDefined();
  expect(withdrawal!.amount).toBe(-10);
  expect(withdrawal!.admin_user_id).toBe(floor.adminUserId);
});

test('negative balance disables the tablet cash-out button', async ({
  page,
  floor,
  factories,
  clock,
}) => {
  await clock.set(new Date('2026-05-04T10:00:00.000Z'));
  await factories.adjustBalance({
    user_id: floor.trackeeUserId,
    amount: -3,
    reason: 'seed negative',
  });

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await tablet.selectTrackee('Bob');
  await tablet.openView('Points');
  await tablet.expectCashOutDisabled();
});
