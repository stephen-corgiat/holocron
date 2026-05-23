import { test, expect } from '../fixtures';
import type { Page, Route } from '@playwright/test';
import { TabletPage } from '../pages/tablet.page';
import { injectTabletToken } from '../fixtures/auth';

/**
 * Doorbell glance overlay — the
 * combined effort's payoff: an HA doorbell **press** (the read-only
 * `binary_sensor.front_door_binarysensor` flipping `off`→`on`) rides the HA
 * `state_changed` WS, stamps `doorbell.rangAt`, and auto-surfaces the
 * **front-door** Scrypted camera as a big frame, with the other cameras as a
 * picker plus a manual Dismiss.
 *
 * Everything is driven against the in-memory HA fake (`/_e2e/ha/state`) and a
 * route-mocked hotlink JPEG — the suite never touches a real HA/Scrypted/
 * doorbell. The 3-min auto-close is driven on the **test clock**
 * (`page.clock`), never a wall-clock wait, so the timer is deterministic and
 * decoupled from the real ~15s sensor pulse.
 *
 * Config (playwright.config.ts): HA on, four `SCRYPTED_CAMERAS`
 * (front_door [doorbell], driveway, back_yard, garage), and
 * `HA_DOORBELL_ENTITY=binary_sensor.front_door_binarysensor`.
 */

// A 1×1 JPEG — the smallest valid body so the `<img>` fires `onload`.
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AvwA//9k=',
  'base64',
);

const HOTLINK_RE = /\/api\/scrypted\/endpoint\/snapshot\//;
const CLOCK_ISO = '2026-05-31T19:42:00.000Z';
const DOORBELL = 'binary_sensor.front_door_binarysensor';
const GLANCE = '.ha-doorbell-glance';

/** Fulfill any hotlink request with the tiny JPEG. */
async function mockHotlink(page: Page): Promise<void> {
  await page.route(HOTLINK_RE, async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'image/jpeg', body: TINY_JPEG });
  });
}

/** Fire the doorbell press edge: the binary_sensor flips to `on`. */
async function ringDoorbell(home: { setState: (e: string, s: string) => Promise<void> }) {
  await home.setState(DOORBELL, 'on');
}

/**
 * Wait until the tablet's socket is connected before ringing. `doorbell.rangAt`
 * only ever arrives as a one-shot live `ha:state_changed` delta (never on the
 * snapshot), so a press emitted before the client has connected is broadcast to
 * nobody and lost.
 */
async function waitForSocket(page: Page): Promise<void> {
  await expect(page.locator('.tb-status-link.connected')).toBeVisible();
}

test('Doorbell: a press opens the glance on the front-door camera with the others as a picker', async ({
  page,
  floor,
  home,
}) => {
  await page.clock.install({ time: new Date(CLOCK_ISO) });
  await mockHotlink(page);

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await waitForSocket(page);

  // No press yet ⇒ no overlay.
  await expect(page.locator(GLANCE)).toHaveCount(0);

  // Doorbell rings (off→on rising edge over the HA WS).
  await ringDoorbell(home);

  // The overlay opens, focused on the front-door camera (big frame).
  const glance = page.locator(GLANCE);
  await expect(glance).toBeVisible();
  await expect(glance).toContainText(/someone's at the front door/i);
  // The big frame is the doorbell camera.
  await expect(
    glance.locator('.ha-camera-tile[data-camera-id="front_door"]'),
  ).toBeVisible();
  await expect(glance).toContainText('Front door');

  // The OTHER cameras appear as the picker (not the front door).
  const picker = glance.locator('.ha-doorbell-picker');
  await expect(picker.locator('button[data-camera-id="driveway"]')).toBeVisible();
  await expect(picker.locator('button[data-camera-id="back_yard"]')).toBeVisible();
  await expect(picker.locator('button[data-camera-id="garage"]')).toBeVisible();
  await expect(picker.locator('button[data-camera-id="front_door"]')).toHaveCount(0);
});

test('Doorbell: picking another camera swaps the big frame; manual Dismiss closes it', async ({
  page,
  floor,
  home,
}) => {
  await page.clock.install({ time: new Date(CLOCK_ISO) });
  await mockHotlink(page);

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await waitForSocket(page);

  await ringDoorbell(home);
  const glance = page.locator(GLANCE);
  await expect(glance).toBeVisible();

  // Pick the driveway from the picker → it becomes the big frame; the front
  // door moves into the picker.
  await glance.locator('.ha-doorbell-picker button[data-camera-id="driveway"]').click();
  await expect(glance).toContainText('Driveway');
  await expect(
    glance.locator('.ha-doorbell-picker button[data-camera-id="front_door"]'),
  ).toBeVisible();
  await expect(
    glance.locator('.ha-doorbell-picker button[data-camera-id="driveway"]'),
  ).toHaveCount(0);

  // Manual Dismiss closes the overlay.
  await glance.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(page.locator(GLANCE)).toHaveCount(0);
});

test('Doorbell: smoke — press → glance → auto-close after 3 min on the test clock', async ({
  page,
  floor,
  home,
}) => {
  await page.clock.install({ time: new Date(CLOCK_ISO) });
  await mockHotlink(page);

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await waitForSocket(page);

  await ringDoorbell(home);
  await expect(page.locator(GLANCE)).toBeVisible();

  // Not yet closed before the 3-min window elapses (decoupled from the ~15s
  // pulse — the sensor falling back to off does NOT close the glance).
  await home.setState(DOORBELL, 'off');
  await page.clock.fastForward(170_000); // 2m50s
  await expect(page.locator(GLANCE)).toBeVisible();

  // Cross the 3-min mark on the test clock ⇒ auto-close.
  await page.clock.fastForward(20_000); // total > 180s
  await expect(page.locator(GLANCE)).toHaveCount(0);
});

test('Doorbell: a new press while open RESETS the 3-min auto-close timer', async ({
  page,
  floor,
  home,
}) => {
  await page.clock.install({ time: new Date(CLOCK_ISO) });
  await mockHotlink(page);

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await waitForSocket(page);

  await ringDoorbell(home); // press 1 @ t0 → 3-min timer armed for t0+180s
  await expect(page.locator(GLANCE)).toBeVisible();
  const firstRangAt = await page.locator(GLANCE).getAttribute('data-rang-at');

  // A second press shortly after (the sensor falls then rises for a fresh
  // edge). The advance is kept small so the socket — which carries the live
  // press delta — is still connected; socket.io's ping logic drops the link
  // across a long fake-clock jump, and the precise multi-minute reset math is
  // covered by the pure reducer unit tests (doorbell-glance.test.ts).
  await page.clock.fastForward(20_000); // t0+20s
  await expect(page.locator('.tb-status-link.connected')).toBeVisible();
  await home.setState(DOORBELL, 'off');
  await home.setState(DOORBELL, 'on'); // press 2 @ t0+20s → timer re-armed for t0+200s
  // Wait for press 2's delta to land before moving the clock again; otherwise
  // the reset is stamped after the next jump and the close window drifts.
  await expect(page.locator(GLANCE)).not.toHaveAttribute('data-rang-at', firstRangAt!);

  // Past the FIRST window (t0+180s) the glance would have closed — but the
  // reset pushed the close to t0+200s, so it is still up at t0+190s.
  await page.clock.fastForward(170_000); // t0+190s
  await expect(page.locator(GLANCE)).toBeVisible();

  // Past the SECOND window ⇒ auto-close.
  await page.clock.fastForward(20_000); // t0+210s
  await expect(page.locator(GLANCE)).toHaveCount(0);
});
