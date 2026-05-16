import { HaConfig } from './ha-config';
import { HaEntityState } from './ha-http-client';
import {
  affectsPanels,
  clampSetpoint,
  fanStateOf,
  shapeClimate,
  shapeCo2,
  shapeFan,
  shapePanels,
  shapeScenes,
} from './panel-shaping';

function st(
  entity_id: string,
  state: string,
  attributes?: Record<string, unknown>,
): HaEntityState {
  return { entity_id, state, attributes };
}

describe('clampSetpoint', () => {
  it('clamps below min and above max', () => {
    expect(clampSetpoint(40, 50, 90, 1)).toBe(50);
    expect(clampSetpoint(99, 50, 90, 1)).toBe(90);
  });

  it('passes through an in-range integer step', () => {
    expect(clampSetpoint(71, 50, 90, 1)).toBe(71);
  });

  it('snaps to a fractional step grid aligned to min', () => {
    expect(clampSetpoint(70.5, 50, 90, 0.5)).toBe(70.5);
    expect(clampSetpoint(70.7, 50, 90, 0.5)).toBe(70.5);
    expect(clampSetpoint(70.8, 50, 90, 0.5)).toBe(71);
  });

  it('avoids binary-float fuzz', () => {
    // 0.1 steps are the classic fuzz source.
    expect(clampSetpoint(70.3, 70, 90, 0.1)).toBe(70.3);
  });

  it('tolerates a zero/absent step (clamp only)', () => {
    expect(clampSetpoint(70.4, 50, 90, 0)).toBe(70.4);
  });
});

describe('shapeClimate', () => {
  it('returns undefined when unconfigured', () => {
    expect(shapeClimate(null, undefined)).toBeUndefined();
  });

  it('shapes current/target/action/unit when ok', () => {
    const state = st('climate.home', 'heat', {
      current_temperature: 68,
      temperature: 70,
      hvac_action: 'heating',
      temperature_unit: '°F',
    });
    expect(shapeClimate('climate.home', state)).toEqual({
      entityId: 'climate.home',
      avail: 'ok',
      current: 68,
      target: 70,
      action: 'heating',
      unit: '°F',
    });
  });

  it('is unavailable when configured but the entity is missing/unknown', () => {
    expect(shapeClimate('climate.home', undefined)).toMatchObject({
      avail: 'unavailable',
    });
    expect(
      shapeClimate('climate.home', st('climate.home', 'unavailable')),
    ).toMatchObject({ avail: 'unavailable' });
  });
});

describe('fanStateOf / shapeFan', () => {
  it('maps off and presets', () => {
    expect(fanStateOf(st('fan.house', 'off'))).toBe('off');
    expect(fanStateOf(st('fan.house', 'on', { preset_mode: 'low' }))).toBe('low');
    expect(fanStateOf(st('fan.house', 'on', { preset_mode: 'High' }))).toBe('high');
  });

  it('maps by percentage when no preset is present', () => {
    expect(fanStateOf(st('fan.house', 'on', { percentage: 30 }))).toBe('low');
    expect(fanStateOf(st('fan.house', 'on', { percentage: 80 }))).toBe('high');
  });

  it('treats an on-but-indeterminate fan as high', () => {
    expect(fanStateOf(st('fan.house', 'on'))).toBe('high');
  });

  it('shapes unavailable when configured-but-offline', () => {
    expect(shapeFan('fan.house', undefined)).toEqual({
      entityId: 'fan.house',
      avail: 'unavailable',
      state: 'off',
    });
    expect(shapeFan(null, undefined)).toBeUndefined();
  });
});

describe('shapeCo2', () => {
  it('parses ppm from the plain sensor state', () => {
    expect(shapeCo2('sensor.co2', st('sensor.co2', '612'))).toEqual({ avail: 'ok', ppm: 612 });
  });

  it('is unavailable for non-numeric/offline', () => {
    expect(shapeCo2('sensor.co2', st('sensor.co2', 'unknown'))).toEqual({ avail: 'unavailable' });
    expect(shapeCo2('sensor.co2', undefined)).toEqual({ avail: 'unavailable' });
  });

  it('returns undefined when unconfigured', () => {
    expect(shapeCo2(null, undefined)).toBeUndefined();
  });
});

describe('shapeScenes', () => {
  const config = (buttons: string[], booleans: string[]): HaConfig =>
    ({ scenes: { buttons, booleans } } as HaConfig);

  it('returns undefined when neither action is configured', () => {
    const byId = () => undefined;
    expect(shapeScenes(config([], []), byId)).toBeUndefined();
  });

  it('renders only the configured action(s), independently optional', () => {
    const byId = (id: string) =>
      id === 'input_boolean.night' ? st(id, 'on') : undefined;
    const scenes = shapeScenes(
      config([], ['input_boolean.night']),
      byId,
    );
    expect(scenes).toEqual({
      nightMode: { entityId: 'input_boolean.night', avail: 'ok', on: true },
    });
  });

  it('reflects button availability and boolean on/off', () => {
    const byId = (id: string) => {
      if (id === 'button.clean') return st(id, '2026-01-01T00:00:00+00:00');
      if (id === 'input_boolean.night') return st(id, 'off');
      return undefined;
    };
    const scenes = shapeScenes(
      config(['button.clean'], ['input_boolean.night']),
      byId,
    );
    expect(scenes).toEqual({
      cleanKitchen: { entityId: 'button.clean', avail: 'ok' },
      nightMode: { entityId: 'input_boolean.night', avail: 'ok', on: false },
    });
  });
});

describe('shapePanels / affectsPanels', () => {
  const config: HaConfig = {
    baseUrl: '',
    token: '',
    onList: { includeDomains: ['light'], excludePatterns: [] },
    doorbellEntity: null,
    cameras: [],
    snapshotWidth: 768,
    climateEntity: 'climate.home',
    fanEntity: 'fan.house',
    fanServices: {
      off: { service: 'fan.turn_off' },
      low: { service: 'fan.set_preset_mode' },
      high: { service: 'fan.set_preset_mode' },
    },
    weatherEntity: 'weather.home',
    co2Entity: 'sensor.co2',
    scenes: { buttons: ['button.clean'], booleans: ['input_boolean.night'] },
  };

  it('folds every configured non-weather panel', () => {
    const states: Record<string, HaEntityState> = {
      'climate.home': st('climate.home', 'heat', { current_temperature: 68, temperature: 70 }),
      'fan.house': st('fan.house', 'on', { preset_mode: 'high' }),
      'sensor.co2': st('sensor.co2', '900'),
      'input_boolean.night': st('input_boolean.night', 'on'),
    };
    const out = shapePanels(config, (id) => states[id]);
    expect(out.climate?.target).toBe(70);
    expect(out.fan).toEqual({ entityId: 'fan.house', avail: 'ok', state: 'high' });
    expect(out.co2).toEqual({ avail: 'ok', ppm: 900 });
    expect(out.scenes?.nightMode).toEqual({
      entityId: 'input_boolean.night',
      avail: 'ok',
      on: true,
    });
  });

  it('flags any configured panel entity as relevant', () => {
    expect(affectsPanels('climate.home', config)).toBe(true);
    expect(affectsPanels('weather.home', config)).toBe(true);
    expect(affectsPanels('button.clean', config)).toBe(true);
    expect(affectsPanels('input_boolean.night', config)).toBe(true);
    expect(affectsPanels('light.kitchen', config)).toBe(false);
  });
});
