import { test, expect } from '../fixtures';
import { TabletPage } from '../pages/tablet.page';
import { injectTabletToken } from '../fixtures/auth';

/**
 * Home-surface skeleton smoke: enabled ⇒ see the on-list ⇒ toggle ⇒ see the
 * live update — driven entirely against the in-memory HA fake (REST + a
 * controllable `state_changed`). No assertion touches the real HA instance,
 * and the toggle is asserted to have hit the **fake**, never a real device.
 */
test('Home surface: lights render, toggle hits the fake, live deltas update the tablet', async ({
  page,
  floor,
  home,
}) => {
  // Two lights/switches on (drives both the fake REST view + a state_changed).
  await home.setState('light.kitchen', 'on', { friendly_name: 'Kitchen' });
  await home.setState('switch.porch', 'on', { friendly_name: 'Porch' });

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();

  // Dock (routine surface) shows the live "N on" count.
  const dock = page.locator('.ha-home-dock');
  await expect(dock).toContainText(/2\s*on/i);

  // Switch to the Home view and see the Currently-On list.
  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  const homeView = page.locator('.ha-home-view');
  await expect(homeView).toContainText('2 ON');
  await expect(page.locator('.ha-light-row', { hasText: 'Kitchen' })).toBeVisible();
  await expect(page.locator('.ha-light-row', { hasText: 'Porch' })).toBeVisible();

  // Toggle Kitchen off — the command must hit the fake (no real device).
  await page
    .locator('.ha-light-row', { hasText: 'Kitchen' })
    .getByRole('switch')
    .click();
  await expect
    .poll(async () => await home.serviceCalls())
    .toContainEqual(
      expect.objectContaining({
        domain: 'light',
        service: 'turn_off',
        data: { entity_id: 'light.kitchen' },
      }),
    );

  // HA confirms the change — a state_changed delta updates the tablet live,
  // with no reload and no extra HTTP from the tablet.
  await home.setState('light.kitchen', 'off');
  await expect(homeView).toContainText('1 ON');
  await expect(page.locator('.ha-light-row', { hasText: 'Kitchen' })).toHaveCount(0);
  await expect(page.locator('.ha-light-row', { hasText: 'Porch' })).toBeVisible();

  // A physically-flipped switch propagates identically to a software toggle.
  await home.setState('light.office', 'on', { friendly_name: 'Office' });
  await expect(homeView).toContainText('2 ON');
  await expect(page.locator('.ha-light-row', { hasText: 'Office' })).toBeVisible();

  // Sanity: the fake is the only command sink — exactly the one toggle landed.
  const calls = await home.serviceCalls();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ domain: 'light', service: 'turn_off' });
});
