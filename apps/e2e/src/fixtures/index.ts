import { test as base, type Page } from '@playwright/test';
import { makeApi, type ApiClient } from './api-client';
import { reset, type SeedFloor } from './reset';
import { clockFixture, type ClockFixture } from './clock';
import { enforcementFixture, type EnforcementFixture } from './enforcement';
import { factoriesFixture, type FactoriesFixture } from './factories';
import { homeFixture, type HomeFixture } from './home';

interface Fixtures {
  api: ApiClient;
  floor: SeedFloor;
  clock: ClockFixture;
  enforcement: EnforcementFixture;
  factories: FactoriesFixture;
  home: HomeFixture;
}

/**
 * Per-test harness. `floor` runs the e2e reset before each test, so every
 * case starts on a freshly-seeded DB (Alice admin + Bob trackee + device +
 * one goal category). The Page is wired to auto-accept any `window.confirm`
 * dialogs the app pops up (lift restriction, reject cash-out), so tests
 * don't have to register a handler each time.
 */
export const test = base.extend<Fixtures>({
  page: async ({ page }: { page: Page }, use: (page: Page) => Promise<void>) => {
    page.on('dialog', (d) => void d.accept());
    await use(page);
  },
  api: async ({}, use) => {
    const api = await makeApi();
    await use(api);
    await api.raw.dispose();
  },
  floor: async ({ api }, use) => {
    const floor = await reset(api);
    await use(floor);
  },
  clock: async ({ api, page }, use) => {
    await use(clockFixture(api, page));
  },
  enforcement: async ({ api }, use) => {
    await use(enforcementFixture(api));
  },
  factories: async ({ api }, use) => {
    await use(factoriesFixture(api));
  },
  home: async ({ api }, use) => {
    await use(homeFixture(api));
  },
});

export { expect } from '@playwright/test';
export type { ApiClient } from './api-client';
export type { SeedFloor } from './reset';
export type { ClockFixture } from './clock';
export type { EnforcementFixture } from './enforcement';
export type { FactoriesFixture } from './factories';
export type { HomeFixture } from './home';
