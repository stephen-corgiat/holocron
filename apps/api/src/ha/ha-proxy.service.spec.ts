import { ForbiddenException } from '@nestjs/common';
import { HaProxyService } from './ha-proxy.service';
import { HaStateStore } from './ha-state-store';
import { HaConfig } from './ha-config';
import { HaEntityState, HaHttpClient } from './ha-http-client';

class StubHttp implements HaHttpClient {
  states: HaEntityState[] = [];
  calls: { domain: string; service: string; data: Record<string, unknown> }[] =
    [];
  getStatesCount = 0;

  async getStates(): Promise<HaEntityState[]> {
    this.getStatesCount++;
    return this.states;
  }

  async callService(
    domain: string,
    service: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    this.calls.push({ domain, service, data });
  }

  async callServiceWithResponse(): Promise<unknown> {
    return {};
  }
}

const baseConfig: HaConfig = {
  baseUrl: 'http://ha.test',
  token: 'tok',
  onList: { includeDomains: ['light', 'switch'], excludePatterns: ['*led'] },
  doorbellEntity: null,
  cameras: [],
  snapshotWidth: 768,
  climateEntity: null,
  fanEntity: null,
  fanServices: {
    off: { service: 'fan.turn_off' },
    low: { service: 'fan.set_preset_mode', data: { preset_mode: 'low' } },
    high: { service: 'fan.set_preset_mode', data: { preset_mode: 'high' } },
  },
  weatherEntity: null,
  co2Entity: null,
  scenes: { buttons: [], booleans: [] },
};

function make(overrides: Partial<HaConfig> = {}) {
  const http = new StubHttp();
  const store = new HaStateStore();
  const config: HaConfig = { ...baseConfig, ...overrides };
  const service = new HaProxyService(http, config, store);
  return { http, store, service, config };
}

describe('HaProxyService.snapshot', () => {
  it('shapes the on-list from the live store when seeded', async () => {
    const { service, store } = make();
    store.setStatus('ok');
    store.replaceAll([
      { entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen' } },
      { entity_id: 'light.office', state: 'off' },
    ]);
    const snap = await service.snapshot();
    expect(snap.status).toBe('ok');
    expect(snap.lights.map((l) => l.entityId)).toEqual(['light.kitchen']);
  });

  it('falls back to a one-shot REST fetch when the store is cold', async () => {
    const { service, http } = make();
    http.states = [{ entity_id: 'switch.porch', state: 'on' }];
    const snap = await service.snapshot();
    expect(http.getStatesCount).toBe(1);
    expect(snap.lights.map((l) => l.entityId)).toEqual(['switch.porch']);
  });

  it('degrades to disconnected + empty when the fetch throws', async () => {
    const { service, http } = make();
    http.getStates = async () => {
      throw new Error('boom');
    };
    const snap = await service.snapshot();
    expect(snap).toEqual({ status: 'disconnected', haEnabled: true, lights: [] });
  });

  it('appends the static camera block + canonical width when configured', async () => {
    const { service, store } = make({
      cameras: [
        { id: 'front', name: 'Front door', doorbell: true, urlTemplate: 'http://ha/x/{ts}.jpg?width={width}' },
        { id: 'drive', name: 'Driveway', urlTemplate: 'http://ha/y/{ts}.jpg?width={width}' },
      ],
      snapshotWidth: 640,
    });
    store.setStatus('ok');
    store.replaceAll([]);
    const snap = await service.snapshot();
    expect(snap.snapshotWidth).toBe(640);
    expect(snap.cameras).toEqual([
      { id: 'front', name: 'Front door', doorbell: true, urlTemplate: 'http://ha/x/{ts}.jpg?width={width}' },
      { id: 'drive', name: 'Driveway', urlTemplate: 'http://ha/y/{ts}.jpg?width={width}' },
    ]);
  });

  it('serves cameras only, never touching HA, when HA creds are absent', async () => {
    const { service, http } = make({
      baseUrl: '',
      token: '',
      cameras: [{ id: 'front', name: 'Front door', urlTemplate: 'http://ha/x/{ts}.jpg?width={width}' }],
    });
    const snap = await service.snapshot();
    expect(http.getStatesCount).toBe(0);
    expect(snap).toEqual({
      status: 'disconnected',
      haEnabled: false,
      lights: [],
      cameras: [{ id: 'front', name: 'Front door', urlTemplate: 'http://ha/x/{ts}.jpg?width={width}' }],
      snapshotWidth: 768,
    });
  });
});

describe('HaProxyService.toggle', () => {
  it('maps on/off to the matching domain service', async () => {
    const { service, http } = make();
    await service.toggle('light.kitchen', false);
    await service.toggle('switch.porch', true);
    expect(http.calls).toEqual([
      { domain: 'light', service: 'turn_off', data: { entity_id: 'light.kitchen' } },
      { domain: 'switch', service: 'turn_on', data: { entity_id: 'switch.porch' } },
    ]);
  });

  it('rejects entities outside the controllable whitelist', async () => {
    const { service, http } = make();
    await expect(service.toggle('lock.front_door', false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(http.calls).toHaveLength(0);
  });
});

describe('HaProxyService.nudgeClimate', () => {
  function seedClimate(
    store: HaStateStore,
    attrs: Record<string, unknown>,
  ): void {
    store.apply({ entity_id: 'climate.home', state: 'heat', attributes: attrs });
  }

  it('reads target, steps by step, and writes the clamped setpoint', async () => {
    const { service, http, store } = make({ climateEntity: 'climate.home' });
    seedClimate(store, {
      temperature: 70,
      min_temp: 50,
      max_temp: 90,
      target_temp_step: 1,
    });
    await service.nudgeClimate('climate.home', 1);
    await service.nudgeClimate('climate.home', -1);
    expect(http.calls).toEqual([
      { domain: 'climate', service: 'set_temperature', data: { entity_id: 'climate.home', temperature: 71 } },
      { domain: 'climate', service: 'set_temperature', data: { entity_id: 'climate.home', temperature: 69 } },
    ]);
  });

  it('clamps to max and never exceeds it', async () => {
    const { service, http, store } = make({ climateEntity: 'climate.home' });
    seedClimate(store, {
      temperature: 90,
      min_temp: 50,
      max_temp: 90,
      target_temp_step: 1,
    });
    await service.nudgeClimate('climate.home', 1);
    expect(http.calls[0].data.temperature).toBe(90);
  });

  it('clamps to min and never goes below it', async () => {
    const { service, http, store } = make({ climateEntity: 'climate.home' });
    seedClimate(store, {
      temperature: 50,
      min_temp: 50,
      max_temp: 90,
      target_temp_step: 0.5,
    });
    await service.nudgeClimate('climate.home', -1);
    expect(http.calls[0].data.temperature).toBe(50);
  });

  it('honors a fractional target_temp_step', async () => {
    const { service, http, store } = make({ climateEntity: 'climate.home' });
    seedClimate(store, {
      temperature: 70,
      min_temp: 50,
      max_temp: 90,
      target_temp_step: 0.5,
    });
    await service.nudgeClimate('climate.home', 1);
    expect(http.calls[0].data.temperature).toBe(70.5);
  });

  it('rejects any entity but the configured climate entity', async () => {
    const { service, http } = make({ climateEntity: 'climate.home' });
    await expect(
      service.nudgeClimate('climate.other', 1),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(http.calls).toHaveLength(0);
  });

  it('rejects when no climate entity is configured', async () => {
    const { service } = make();
    await expect(
      service.nudgeClimate('climate.home', 1),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('HaProxyService.setFan', () => {
  it('maps each state via the config-driven service map', async () => {
    const { service, http } = make({ fanEntity: 'fan.house' });
    await service.setFan('fan.house', 'off');
    await service.setFan('fan.house', 'low');
    await service.setFan('fan.house', 'high');
    expect(http.calls).toEqual([
      { domain: 'fan', service: 'turn_off', data: { entity_id: 'fan.house' } },
      { domain: 'fan', service: 'set_preset_mode', data: { entity_id: 'fan.house', preset_mode: 'low' } },
      { domain: 'fan', service: 'set_preset_mode', data: { entity_id: 'fan.house', preset_mode: 'high' } },
    ]);
  });

  it('respects a custom service map (e.g. set_percentage)', async () => {
    const { service, http } = make({
      fanEntity: 'fan.house',
      fanServices: {
        off: { service: 'fan.turn_off' },
        low: { service: 'fan.set_percentage', data: { percentage: 33 } },
        high: { service: 'fan.set_percentage', data: { percentage: 100 } },
      },
    });
    await service.setFan('fan.house', 'low');
    expect(http.calls[0]).toEqual({
      domain: 'fan',
      service: 'set_percentage',
      data: { entity_id: 'fan.house', percentage: 33 },
    });
  });

  it('rejects any entity but the configured fan', async () => {
    const { service, http } = make({ fanEntity: 'fan.house' });
    await expect(service.setFan('fan.other', 'low')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(http.calls).toHaveLength(0);
  });
});

describe('HaProxyService scenes', () => {
  it('presses a configured button via button.press', async () => {
    const { service, http } = make({
      scenes: { buttons: ['button.clean_kitchen'], booleans: [] },
    });
    await service.pressButton('button.clean_kitchen');
    expect(http.calls).toEqual([
      { domain: 'button', service: 'press', data: { entity_id: 'button.clean_kitchen' } },
    ]);
  });

  it('rejects an unconfigured button', async () => {
    const { service } = make({
      scenes: { buttons: ['button.clean_kitchen'], booleans: [] },
    });
    await expect(
      service.pressButton('button.other'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('toggles a configured input_boolean on/off', async () => {
    const { service, http } = make({
      scenes: { buttons: [], booleans: ['input_boolean.night_mode'] },
    });
    await service.setBoolean('input_boolean.night_mode', true);
    await service.setBoolean('input_boolean.night_mode', false);
    expect(http.calls).toEqual([
      { domain: 'input_boolean', service: 'turn_on', data: { entity_id: 'input_boolean.night_mode' } },
      { domain: 'input_boolean', service: 'turn_off', data: { entity_id: 'input_boolean.night_mode' } },
    ]);
  });

  it('rejects an unconfigured boolean', async () => {
    const { service } = make({
      scenes: { buttons: [], booleans: ['input_boolean.night_mode'] },
    });
    await expect(
      service.setBoolean('input_boolean.other', true),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('HaProxyService.snapshot panels', () => {
  it('includes only configured panels', async () => {
    const { service, store } = make({
      climateEntity: 'climate.home',
      co2Entity: 'sensor.co2',
    });
    store.setStatus('ok');
    store.replaceAll([
      { entity_id: 'light.kitchen', state: 'on' },
      { entity_id: 'climate.home', state: 'heat', attributes: { current_temperature: 68, temperature: 70, hvac_action: 'heating' } },
      { entity_id: 'sensor.co2', state: '612' },
      { entity_id: 'fan.house', state: 'on' }, // not configured ⇒ no fan field
    ]);
    const snap = await service.snapshot();
    expect(snap.climate).toEqual({ entityId: 'climate.home', avail: 'ok', current: 68, target: 70, action: 'heating', unit: '°F' });
    expect(snap.co2).toEqual({ avail: 'ok', ppm: 612 });
    expect(snap.fan).toBeUndefined();
    expect(snap.weather).toBeUndefined();
    expect(snap.scenes).toBeUndefined();
  });

  it('marks a configured-but-offline panel unavailable', async () => {
    const { service, store } = make({ fanEntity: 'fan.house' });
    store.setStatus('ok');
    store.replaceAll([{ entity_id: 'fan.house', state: 'unavailable' }]);
    const snap = await service.snapshot();
    expect(snap.fan).toEqual({ entityId: 'fan.house', avail: 'unavailable', state: 'off' });
  });
});
