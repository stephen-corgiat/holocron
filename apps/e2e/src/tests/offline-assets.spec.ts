import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { TabletPage } from '../pages/tablet.page';
import { LoginPage } from '../pages/login.page';
import { injectTabletToken } from '../fixtures/auth';

/**
 * The wall tablet has no Internet access. Any asset fetched from a public
 * host (e.g. a Google Fonts stylesheet) blocks on a DNS/connect timeout and
 * stalls a hard refresh, so every font/script/style must be bundled and served
 * by the app itself.
 *
 * Allowed hosts: loopback (the Vite dev server + API) and the reserved `.test`
 * TLD the e2e harness uses for its HA/Scrypted fakes (a LAN host in prod).
 */
function trackOffHostRequests(page: Page): string[] {
  const offHost: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    const host = url.hostname;
    if (host === '127.0.0.1' || host === 'localhost' || host.endsWith('.test')) {
      return;
    }
    offHost.push(req.url());
  });
  return offHost;
}

async function expectBundledFontsLoaded(page: Page): Promise<void> {
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      inter: document.fonts.check('16px Inter'),
      mono: document.fonts.check('16px "JetBrains Mono"'),
    };
  });
  expect(loaded).toEqual({ inter: true, mono: true });
}

test('login page loads without any off-host requests', async ({
  page,
  floor: _floor,
}) => {
  const offHost = trackOffHostRequests(page);
  const login = new LoginPage(page);
  await login.goto();
  await page.waitForLoadState('networkidle');
  await expectBundledFontsLoaded(page);
  expect(offHost).toEqual([]);
});

test('tablet loads without any off-host requests', async ({ page, floor }) => {
  const offHost = trackOffHostRequests(page);
  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await page.waitForLoadState('networkidle');
  await expectBundledFontsLoaded(page);
  expect(offHost).toEqual([]);
});
