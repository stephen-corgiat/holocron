import { test, expect } from '../fixtures';
import type { Page, Route } from '@playwright/test';
import { TabletPage } from '../pages/tablet.page';
import { injectTabletToken } from '../fixtures/auth';

/**
 * Cameras — the tablet renders
 * Scrypted snapshot tiles by hotlinking an unauthenticated URL directly from
 * an `<img>`, refreshing every 5s with a fresh `{ts}` cache-buster at one
 * canonical `{width}`. Freshness/offline is FE-derived from the `<img>`
 * load/error events.
 *
 * The hotlink endpoint is **route-mocked** so the suite never touches a real
 * HA/Scrypted: every request to the fake host is fulfilled with a tiny JPEG.
 * The browser clock is installed so the 5s `src`-swap can be driven
 * deterministically (no wall-clock waits), mirroring how the rest of the suite
 * drives time.
 *
 * Camera config is supplied via `SCRYPTED_CAMERAS` in playwright.config.ts
 * (front_door [doorbell], driveway, back_yard, garage at width 768) and served
 * statically on `GET /ha/snapshot`.
 */

// A 1×1 JPEG — the smallest valid body so the `<img>` fires `onload`.
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AvwA//9k=',
  'base64',
);

const HOTLINK_RE = /\/api\/scrypted\/endpoint\/snapshot\//;
const CLOCK_ISO = '2026-05-04T09:00:00.000Z';

/** Fulfill any hotlink request with the tiny JPEG; record the requested URLs. */
async function mockHotlink(page: Page, seen: string[]): Promise<void> {
  await page.route(HOTLINK_RE, async (route: Route) => {
    seen.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      body: TINY_JPEG,
    });
  });
}

test('Cameras: grid + filmstrip render from snapshot config, src swaps every 5s', async ({
  page,
  floor,
}) => {
  const seen: string[] = [];
  await page.clock.install({ time: new Date(CLOCK_ISO) });
  await mockHotlink(page, seen);

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();

  // ── Dock filmstrip (routine surface) — one live thumb per configured cam ──
  const filmstrip = page.locator('.ha-camera-filmstrip');
  await expect(filmstrip).toBeVisible();
  await expect(page.locator('.ha-camera-thumb')).toHaveCount(4);
  // The doorbell camera is flagged distinctly.
  await expect(
    page.locator('.ha-camera-thumb[data-camera-id="front_door"]'),
  ).toBeVisible();

  // Every request carries the one canonical width and a cache-busting ts.
  await expect.poll(() => seen.length).toBeGreaterThanOrEqual(4);
  for (const url of seen) {
    expect(url).toContain('width=768');
  }

  // ── 5s src-swap ──────────────────────────────────────────────────────
  // The visible frame (`.ha-camera-frame`) only updates on a successful probe
  // load. Snapshot its current src, advance the FE clock one refresh cycle,
  // and assert it changed (a fresh {ts} cache-buster).
  const frontImg = page
    .locator('.ha-camera-thumb[data-camera-id="front_door"] img.ha-camera-frame')
    .first();
  await expect(frontImg).toHaveAttribute('src', /width=768/);
  const firstSrc = await frontImg.getAttribute('src');

  await page.clock.fastForward(5000);
  await expect
    .poll(async () => await frontImg.getAttribute('src'))
    .not.toBe(firstSrc);

  // ── Home-view 2×2 grid ────────────────────────────────────────────────────
  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  const grid = page.locator('.ha-camera-grid');
  await expect(grid).toBeVisible();
  await expect(page.locator('.ha-camera-tile')).toHaveCount(4);
  await expect(grid).toContainText('Front door');
  await expect(grid).toContainText('Driveway');
  await expect(grid).toContainText('Back yard');
  await expect(grid).toContainText('Garage');
  // Successful loads ⇒ tiles are fresh.
  await expect
    .poll(async () =>
      page.locator('.ha-camera-tile[data-camera-status="fresh"]').count(),
    )
    .toBeGreaterThan(0);
});

test('Cameras: a tile that keeps erroring falls back to OFFLINE, keeping the last frame path', async ({
  page,
  floor,
}) => {
  await page.clock.install({ time: new Date(CLOCK_ISO) });

  // Front door fails every request; the others succeed.
  await page.route(HOTLINK_RE, async (route: Route) => {
    if (route.request().url().includes('/front_door/')) {
      await route.abort();
    } else {
      await route.fulfill({ status: 200, contentType: 'image/jpeg', body: TINY_JPEG });
    }
  });

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();

  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  const front = page.locator('.ha-camera-tile[data-camera-id="front_door"]');
  await expect(front).toBeVisible();

  // Drive several refresh cycles so the repeated onerror trips OFFLINE.
  for (let i = 0; i < 3; i++) {
    await page.clock.fastForward(5000);
  }
  await expect
    .poll(async () => await front.getAttribute('data-camera-status'))
    .toBe('offline');
  await expect(front).toContainText(/camera offline/i);

  // The healthy cameras stay fresh — one bad feed never blanks the others.
  await expect(
    page.locator('.ha-camera-tile[data-camera-id="driveway"][data-camera-status="fresh"]'),
  ).toBeVisible();
});

test('Cameras: refreshes that stop succeeding (no error) dim to STALE', async ({
  page,
  floor,
}) => {
  await page.clock.install({ time: new Date(CLOCK_ISO) });

  // Serve every frame until we flip `hang`; afterwards later requests are left
  // pending (no onload, no onerror) so the tile keeps its last-good frame but
  // silently stops refreshing. (A per-camera "first only" mock fails here: the
  // dock filmstrip loads each camera once on the routine surface *before* the
  // grid mounts, starving the grid tile of its own first frame.)
  let hang = false;
  await page.route(HOTLINK_RE, async (route: Route) => {
    if (hang) return; // leave pending — neither load nor error
    await route.fulfill({ status: 200, contentType: 'image/jpeg', body: TINY_JPEG });
  });

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();

  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  const front = page.locator('.ha-camera-tile[data-camera-id="front_door"]');
  await expect(front).toBeVisible();
  // Anchor lastGoodAt: wait for the grid tile's first frame to actually LOAD
  // (the visible `<img>` only renders once a probe promotes). The clock is
  // paused, so it's stamped at the current fake time.
  await expect(front.locator('img.ha-camera-frame')).toBeVisible();
  await expect
    .poll(async () => await front.getAttribute('data-camera-status'))
    .toBe('fresh');

  // Stop serving, then let ~5 refresh cycles pass with no load and no error.
  // `runFor` ticks *through* the window (firing the per-cycle re-derive
  // heartbeat each cycle), unlike `fastForward` which jumps and fires a due
  // timer at most once — so the tile actually ages fresh → stale.
  hang = true;
  await page.clock.runFor(25_000);
  await expect
    .poll(async () => await front.getAttribute('data-camera-status'))
    .toBe('stale');
  await expect(front).toContainText(/stale/i);
});
