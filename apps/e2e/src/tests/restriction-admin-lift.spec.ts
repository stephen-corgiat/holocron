import { test, expect } from '../fixtures';
import { AdminRestrictionsPage } from '../pages/admin-restrictions.page';
import { TabletPage } from '../pages/tablet.page';
import { injectAdminToken, injectTabletToken } from '../fixtures/auth';

test('Admin Lift-early clears the Restriction and pushes the tablet back to routine', async ({
  page,
  api,
  floor,
  enforcement,
  clock,
}) => {
  await clock.set(new Date('2026-05-04T10:00:00.000Z'));
  await enforcement.resetLogs();

  // Seed an active Restriction via API.
  await api.post(
    `/admin/restrictions/block-now`,
    {
      user_id: floor.trackeeUserId,
      scope: 'internet',
      reason: 'admin set up',
    },
    floor.adminToken,
  );

  await injectAdminToken(page, floor);
  const restrictions = new AdminRestrictionsPage(page);
  await restrictions.goto();
  await expect(restrictions.activeRow('Bob', 'internet')).toBeVisible();

  await enforcement.resetLogs();
  await restrictions.liftEarly('Bob', 'internet');

  // Row gone.
  await expect(restrictions.activeRow('Bob', 'internet')).toHaveCount(0);

  // Router fake saw a `del` (deactivate) call.
  const calls = await enforcement.routerLog();
  expect(
    calls.some(
      (c) =>
        /internet/.test(c.url) && /\/del\?/.test(c.url) && /10\.0\.0\.42/.test(c.url),
    ),
  ).toBe(true);

  // Tablet: lock badge gone via WS push.
  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await tablet.waitForNoLockBadge('Bob');
});
