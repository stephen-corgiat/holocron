import { test, expect } from '../fixtures';
import { TabletEnrollPage } from '../pages/tablet-enroll.page';

test('tablet enrolls via one-time code and lands on routine', async ({
  page,
  floor,
}) => {
  const enroll = new TabletEnrollPage(page);
  await enroll.goto();
  await enroll.enroll(floor.enrollmentCode);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.tb-tabbar')).toBeVisible();
  // Bob's tab should be visible by accessible-name.
  await expect(page.getByRole('tab', { name: /bob/i })).toBeVisible();
});

test('invalid enrollment code shows error', async ({ page, floor: _floor }) => {
  const enroll = new TabletEnrollPage(page);
  await enroll.goto();
  await enroll.enroll('ZZZZZZZZ');
  await expect(page.locator('.auth-error')).toBeVisible();
});
