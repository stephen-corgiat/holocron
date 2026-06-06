import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const WEB_URL = process.env.HOLOCRON_WEB_URL ?? 'http://127.0.0.1:5173';
const API_URL = process.env.HOLOCRON_API_URL ?? 'http://127.0.0.1:3000';
const REPO_ROOT = path.resolve(__dirname, '../..');

const SCREENSHOT_DB = process.env.SCREENSHOT_DB ?? 'holocron_screenshots';

/**
 * Dedicated Playwright project for generating the README hero GIF. Boots the
 * real API + web on a separate Postgres database, runs the JSON-driven seed
 * (the same starter household a fresh install gets), then walks through a
 * scripted storyboard recording the page as webm. `scripts/screenshots/
 * build-gif.mjs` converts that webm into `docs/screenshots/hero.gif`.
 *
 * Distinct from `playwright.config.ts` (the golden-path suite) in three ways:
 *  - Uses its own DB so it never collides with dev or e2e state.
 *  - Records video unconditionally at a tablet-friendly 1280x800.
 *  - Keeps `E2E_TEST_MODE=true` so the spec can pin the clock and force
 *    occurrence materialization, but DOES NOT call `/_e2e/reset` — the seed
 *    is the starting state.
 */
export default defineConfig({
  testDir: './src/screenshots',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(REPO_ROOT, 'test-results-screenshots'),
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    // Static-screenshot pipeline. No need to record video — the spec
    // captures crisp PNGs directly at each beat, and the build script
    // stitches them into a slideshow GIF.
    video: 'off',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    extraHTTPHeaders: {
      'x-e2e-api': API_URL,
    },
  },
  webServer: [
    {
      command: 'npm --workspace apps/api run start:dev',
      cwd: REPO_ROOT,
      url: `${API_URL}/healthz`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        E2E_TEST_MODE: 'true',
        TZ: 'UTC',
        POSTGRES_DB: SCREENSHOT_DB,
        ROUTER_BASE_URL: 'http://fake-router.test',
        ROUTER_BEARER_TOKEN: 'fake',
        PIHOLE_BASE_URL: 'http://fake-pihole.test',
        PIHOLE_API_PASSWORD: 'fake',
        JWT_SECRET: 'screenshots-secret-32-chars-min-not-for-prod-use',
        WEB_ORIGIN: WEB_URL,
      },
    },
    {
      command: 'npm --workspace apps/web run dev',
      cwd: REPO_ROOT,
      url: WEB_URL,
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
});
