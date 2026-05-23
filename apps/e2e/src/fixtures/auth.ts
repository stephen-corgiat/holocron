import type { Page } from '@playwright/test';
import type { SeedFloor } from './reset';

const TABLET_KEY = 'holocron.tablet_token';
const ADMIN_KEY = 'holocron.admin_token';

/**
 * Bypass the login UI by stuffing tokens into the right web storage. The
 * `addInitScript` runs before every navigation, so both tokens are forced
 * to the right values on each page load — switching surfaces inside a
 * single test just works.
 */
export async function injectTabletToken(
  page: Page,
  floor: SeedFloor,
): Promise<void> {
  await page.addInitScript(
    ({ tabletKey, tabletToken, adminKey }) => {
      localStorage.setItem(tabletKey, tabletToken);
      sessionStorage.removeItem(adminKey);
    },
    { tabletKey: TABLET_KEY, tabletToken: floor.tabletToken, adminKey: ADMIN_KEY },
  );
}

export async function injectAdminToken(
  page: Page,
  floor: SeedFloor,
): Promise<void> {
  await page.addInitScript(
    ({ adminKey, adminToken, tabletKey }) => {
      sessionStorage.setItem(adminKey, adminToken);
      localStorage.removeItem(tabletKey);
    },
    { adminKey: ADMIN_KEY, adminToken: floor.adminToken, tabletKey: TABLET_KEY },
  );
}

export async function clearTokens(page: Page): Promise<void> {
  await page.addInitScript(
    ({ tablet, admin }) => {
      localStorage.removeItem(tablet);
      sessionStorage.removeItem(admin);
    },
    { tablet: TABLET_KEY, admin: ADMIN_KEY },
  );
}
