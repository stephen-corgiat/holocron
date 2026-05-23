import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const WEB_URL = process.env.HOLOCRON_WEB_URL ?? 'http://127.0.0.1:5173';
const API_URL = process.env.HOLOCRON_API_URL ?? 'http://127.0.0.1:3000';
const REPO_ROOT = path.resolve(__dirname, '../..');

export default defineConfig({
  testDir: './src/tests',
  fullyParallel: false,
  // Tests share a single API/Postgres + reset between cases, so they must
  // run sequentially.
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 7_500 },
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    extraHTTPHeaders: {
      'x-e2e-api': API_URL,
    },
  },
  webServer: [
    {
      command: 'npm --workspace apps/api run start:dev',
      cwd: REPO_ROOT,
      url: `${API_URL}/healthz`,
      timeout: 90_000,
      reuseExistingServer: !process.env.CI,
      env: {
        E2E_TEST_MODE: 'true',
        // Lock the API process to UTC so e2e specs can reason about
        // due_time / window math without round-tripping through the host's
        // timezone.
        TZ: 'UTC',
        // Provide harmless defaults for the real router/PiHole config
        // factories — the IS_E2E branch ignores them but ConfigService
        // still has to resolve them.
        ROUTER_BASE_URL: 'http://fake-router.test',
        ROUTER_BEARER_TOKEN: 'fake',
        PIHOLE_BASE_URL: 'http://fake-pihole.test',
        PIHOLE_API_PASSWORD: 'fake',
        // Turn the home-surface (HA) module ON for e2e — the IS_E2E branch
        // swaps in the in-memory HA fakes, so these point at nothing real.
        HA_BASE_URL: 'http://fake-ha.test',
        HA_TOKEN: 'fake',
        // Doorbell press sensor: a read-only
        // binary_sensor whose off→on edge stamps `doorbell.rangAt`, which the
        // FE turns into the glance overlay. Driven via `/_e2e/ha/state`.
        HA_DOORBELL_ENTITY: 'binary_sensor.front_door_binarysensor',
        // Scrypted cameras: static config served on /ha/snapshot. The
        // hotlink URLs point at a fake host the camera spec route-mocks, so no
        // real HA/Scrypted is ever hit. `{ts}` cache-buster + the one
        // canonical `{width}` are substituted by the FE.
        SCRYPTED_CAMERAS: JSON.stringify([
          {
            id: 'front_door',
            name: 'Front door',
            doorbell: true,
            urlTemplate:
              'http://fake-ha.test/api/scrypted/endpoint/snapshot/front_door/{ts}.jpg?width={width}&reason=periodic',
          },
          {
            id: 'driveway',
            name: 'Driveway',
            urlTemplate:
              'http://fake-ha.test/api/scrypted/endpoint/snapshot/driveway/{ts}.jpg?width={width}&reason=periodic',
          },
          {
            id: 'back_yard',
            name: 'Back yard',
            urlTemplate:
              'http://fake-ha.test/api/scrypted/endpoint/snapshot/back_yard/{ts}.jpg?width={width}&reason=periodic',
          },
          {
            id: 'garage',
            name: 'Garage',
            urlTemplate:
              'http://fake-ha.test/api/scrypted/endpoint/snapshot/garage/{ts}.jpg?width={width}&reason=periodic',
          },
        ]),
        SCRYPTED_SNAPSHOT_WIDTH: '768',
        // Configure every optional panel so the panels spec can drive them.
        // These are e2e example ids only (no hard-coded ids in code).
        HA_CLIMATE_ENTITY: 'climate.home',
        HA_FAN_ENTITY: 'fan.house',
        // fan.house is a percentage fan (0=off, 50=low, 100=high), matching the
        // live-verified deployment. Pin the map here so the e2e is deterministic
        // regardless of any local apps/api/.env (which is gitignored, so absent
        // in CI — without this the API would fall back to the preset-mode
        // default and the assertions below would diverge by environment).
        HA_FAN_SERVICES: JSON.stringify({
          off: { service: 'fan.set_percentage', data: { percentage: 0 } },
          low: { service: 'fan.set_percentage', data: { percentage: 50 } },
          high: { service: 'fan.set_percentage', data: { percentage: 100 } },
        }),
        HA_WEATHER_ENTITY: 'weather.home',
        HA_CO2_ENTITY: 'sensor.co2',
        HA_SCENE_BUTTONS: 'button.clean_kitchen',
        HA_SCENE_BOOLEANS: 'input_boolean.night_mode',
        JWT_SECRET: 'e2e-test-secret-32-chars-min-not-for-prod-use',
        WEB_ORIGIN: WEB_URL,
      },
    },
    {
      command: 'npm --workspace apps/web run dev',
      cwd: REPO_ROOT,
      url: WEB_URL,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
