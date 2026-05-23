import { test, expect } from '../fixtures';
import { TabletPage } from '../pages/tablet.page';
import { injectTabletToken } from '../fixtures/auth';

const CLIMATE = 'climate.home';
const FAN = 'fan.house';
const WEATHER = 'weather.home';
const CO2 = 'sensor.co2';
const CLEAN = 'button.clean_kitchen';
const NIGHT = 'input_boolean.night_mode';

/**
 * Home-surface panels smoke: each configured panel renders and one
 * command each lands on the **HA fake** — never a real device. Crucially the
 * House Fan is never actually switched and the Thermostat setpoint is never
 * actually changed: the fake only records the service call and reflects state
 * the suite drives. The clock/state are driven explicitly (no wall-clock waits).
 */
test('Home panels: each renders + one command each hits the fake (no real device)', async ({
  page,
  floor,
  home,
}) => {
  // ── Drive states for every panel ──────────────────────────────────────────
  await home.setState('light.kitchen', 'on', { friendly_name: 'Kitchen' });
  await home.setState(CLIMATE, 'heat', {
    current_temperature: 68,
    temperature: 70,
    hvac_action: 'heating',
    min_temp: 50,
    max_temp: 90,
    target_temp_step: 1,
    temperature_unit: '°F',
  });
  await home.setState(FAN, 'on', { preset_mode: 'high' });
  await home.setState(CO2, '612');
  await home.setState(WEATHER, 'sunny', { temperature: 72 });
  await home.setState(CLEAN, '2026-05-31T00:00:00+00:00');
  await home.setState(NIGHT, 'off');
  // Seed + fold the cached forecast (no provider round-trip).
  await home.setForecast(WEATHER, [
    { condition: 'sunny', templow: 54, temperature: 78 },
  ]);
  await home.forecastPoll();

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();

  // ── Dock (routine surface): weather · CO₂ · thermostat · fan all visible ───
  const dock = page.locator('.ha-home-dock');
  await expect(dock).toContainText('72°');
  const co2 = dock.locator('.ha-dock-co2');
  await expect(co2).toContainText('CO₂');
  await expect(co2).toContainText('612');
  await expect(co2).toContainText('ppm');
  await expect(dock).toContainText('70°'); // thermostat target
  await expect(dock.getByRole('group', { name: 'House fan speed' })).toBeVisible();

  // ── Switch to the Home view and see every panel ───────────────────────────
  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  const homeView = page.locator('.ha-home-view');
  await expect(homeView).toContainText('Currently on');
  await expect(homeView).toContainText('Thermostat');
  await expect(homeView).toContainText('House fan');
  await expect(homeView).toContainText('Weather');
  await expect(homeView).toContainText('Scenes');
  // Thermostat shows the target + condition shows in weather.
  await expect(page.getByTestId('thermostat-target')).toHaveText('70');
  await expect(homeView).toContainText('Sunny');
  await expect(homeView).toContainText('54°'); // LO from the cached forecast
  await expect(homeView).toContainText('78°'); // HI from the cached forecast

  // ── One command each — assert each hits the fake (mocks only) ──────────────

  // Thermostat +: tablet sends only a direction; the server clamps + writes 71.
  await page.getByRole('button', { name: 'Raise target temperature' }).first().click();
  await expect
    .poll(async () => await home.serviceCalls())
    .toContainEqual(
      expect.objectContaining({
        domain: 'climate',
        service: 'set_temperature',
        data: { entity_id: CLIMATE, temperature: 71 },
      }),
    );

  // House fan → Low via the config-driven state→service map. fan.house is a
  // percentage fan (see HA_FAN_SERVICES in playwright.config.ts): Low maps to
  // set_percentage @ 50.
  await homeView
    .getByRole('group', { name: 'House fan speed' })
    .getByRole('button', { name: 'Low' })
    .click();
  await expect
    .poll(async () => await home.serviceCalls())
    .toContainEqual(
      expect.objectContaining({
        domain: 'fan',
        service: 'set_percentage',
        data: { entity_id: FAN, percentage: 50 },
      }),
    );

  // Scenes — Clean Kitchen issues button.press (momentary, no state).
  await page.getByRole('button', { name: 'Clean Kitchen' }).click();
  await expect
    .poll(async () => await home.serviceCalls())
    .toContainEqual(
      expect.objectContaining({
        domain: 'button',
        service: 'press',
        data: { entity_id: CLEAN },
      }),
    );

  // Scenes — Night Mode toggles the input_boolean and reflects live state.
  await page.getByRole('switch', { name: 'Night Mode' }).click();
  await expect
    .poll(async () => await home.serviceCalls())
    .toContainEqual(
      expect.objectContaining({
        domain: 'input_boolean',
        service: 'turn_on',
        data: { entity_id: NIGHT },
      }),
    );
  // HA confirms — a state_changed delta flips Night Mode to On live.
  await home.setState(NIGHT, 'on');
  await expect(page.getByRole('switch', { name: 'Night Mode' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // ── The fake is the only sink: the real device was never touched ───────────
  const calls = await home.serviceCalls();
  // No real turn-on/off of the physical fan beyond the mapped preset call, and
  // no setpoint write other than the single clamped nudge.
  const climateWrites = calls.filter((c) => c.domain === 'climate');
  expect(climateWrites).toHaveLength(1);
  expect(climateWrites[0].data).toEqual({ entity_id: CLIMATE, temperature: 71 });
  const fanWrites = calls.filter((c) => c.domain === 'fan');
  expect(fanWrites).toHaveLength(1);
  expect(fanWrites[0]).toMatchObject({ service: 'set_percentage' });
});

/**
 * Per-panel optionality + degraded treatment: a configured-but-
 * offline climate/fan shows the dimmed UNAVAILABLE pill; an offline weather
 * shows "No weather data". (Unconfigured ⇒ not rendered — covered by config,
 * not drivable per-test since the env configures every panel.)
 */
test('Home panels: configured-but-offline shows UNAVAILABLE / No weather data', async ({
  page,
  floor,
  home,
}) => {
  await home.setState('light.kitchen', 'on', { friendly_name: 'Kitchen' });
  await home.setState(CLIMATE, 'unavailable');
  await home.setState(FAN, 'unavailable');
  await home.setState(WEATHER, 'unavailable');
  await home.setState(CO2, 'unknown');

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();

  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  const homeView = page.locator('.ha-home-view');
  // Climate + fan both dimmed UNAVAILABLE.
  await expect(homeView.getByText('UNAVAILABLE')).toHaveCount(2);
  // Weather degraded → "No weather data".
  await expect(homeView).toContainText('No weather data');
});
