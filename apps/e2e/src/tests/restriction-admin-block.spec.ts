import { test, expect } from '../fixtures';
import { AdminRestrictionsPage } from '../pages/admin-restrictions.page';
import { TabletPage } from '../pages/tablet.page';
import { injectAdminToken, injectTabletToken } from '../fixtures/auth';

test('Admin Block-now creates a Restriction and fires the router fake', async ({
  page,
  api,
  floor,
  enforcement,
  clock,
}) => {
  await clock.set(new Date('2026-05-04T10:00:00.000Z'));
  await enforcement.resetLogs();

  await injectAdminToken(page, floor);
  const restrictions = new AdminRestrictionsPage(page);
  await restrictions.goto();

  await restrictions.clickBlockNow('internet');
  await restrictions.submitBlockModal('Bob', 'screen time exceeded');

  // Restriction visible in active list.
  await expect(restrictions.activeRow('Bob', 'internet')).toBeVisible();

  // Router fake saw an `add` (activate) call for Bob's IP on the internet scope.
  const calls = await enforcement.routerLog();
  expect(
    calls.some(
      (c) =>
        /internet/.test(c.url) && /\/add\?/.test(c.url) && /10\.0\.0\.42/.test(c.url),
    ),
  ).toBe(true);

  // API confirms: Bob has an active internet restriction.
  const ov = await api.get<{
    active: Array<{ user_id: string; scope: string; causes: unknown[] }>;
  }>(
    `/admin/restrictions`,
    floor.adminToken,
  );
  expect(
    ov.active.some(
      (r) => r.user_id === floor.trackeeUserId && r.scope === 'internet',
    ),
  ).toBe(true);

  // Tablet shows the lock badge on Bob's tab.
  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await tablet.waitForLockBadge('Bob');
});
