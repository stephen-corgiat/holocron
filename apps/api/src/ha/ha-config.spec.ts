import {
  isCamerasConfigured,
  isHaConfigured,
  isHomeConfigured,
  loadHaConfig,
  parseCameras,
} from './ha-config';
import type { ConfigService } from '@nestjs/config';

/** Minimal ConfigService stub backed by a plain env map. */
function fakeConfig(env: Record<string, string>): ConfigService {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

describe('parseCameras', () => {
  it('returns [] for unset / blank / malformed input', () => {
    expect(parseCameras(undefined)).toEqual([]);
    expect(parseCameras('')).toEqual([]);
    expect(parseCameras('   ')).toEqual([]);
    expect(parseCameras('not json')).toEqual([]);
    expect(parseCameras('{"id":"x"}')).toEqual([]); // not an array
  });

  it('parses a well-formed camera list', () => {
    const cams = parseCameras(
      JSON.stringify([
        {
          id: 'front',
          name: 'Front door',
          doorbell: true,
          urlTemplate: 'http://ha/x/{ts}.jpg?width={width}',
        },
        { id: 'drive', name: 'Driveway', urlTemplate: 'http://ha/y/{ts}.jpg' },
      ]),
    );
    expect(cams).toEqual([
      {
        id: 'front',
        name: 'Front door',
        doorbell: true,
        urlTemplate: 'http://ha/x/{ts}.jpg?width={width}',
      },
      { id: 'drive', name: 'Driveway', urlTemplate: 'http://ha/y/{ts}.jpg' },
    ]);
  });

  it('drops entries missing id or urlTemplate, and defaults name to id', () => {
    const cams = parseCameras(
      JSON.stringify([
        { id: 'a', urlTemplate: 'http://ha/a.jpg' }, // no name ⇒ id
        { id: 'b' }, // no urlTemplate ⇒ dropped
        { urlTemplate: 'http://ha/c.jpg' }, // no id ⇒ dropped
        'garbage',
        null,
      ]),
    );
    expect(cams).toEqual([
      { id: 'a', name: 'a', urlTemplate: 'http://ha/a.jpg' },
    ]);
  });

  it('omits doorbell unless explicitly true', () => {
    const cams = parseCameras(
      JSON.stringify([
        { id: 'a', urlTemplate: 'u', doorbell: false },
        { id: 'b', urlTemplate: 'u', doorbell: 'yes' },
      ]),
    );
    expect(cams[0]).not.toHaveProperty('doorbell');
    expect(cams[1]).not.toHaveProperty('doorbell');
  });
});

describe('home-surface gates', () => {
  const camEnv = {
    SCRYPTED_CAMERAS: JSON.stringify([{ id: 'a', urlTemplate: 'u' }]),
  };

  it('isHaConfigured needs both HA creds', () => {
    expect(isHaConfigured({})).toBe(false);
    expect(isHaConfigured({ HA_BASE_URL: 'http://ha' })).toBe(false);
    expect(isHaConfigured({ HA_BASE_URL: 'http://ha', HA_TOKEN: 't' })).toBe(true);
  });

  it('isCamerasConfigured needs at least one valid camera', () => {
    expect(isCamerasConfigured({})).toBe(false);
    expect(isCamerasConfigured({ SCRYPTED_CAMERAS: '[]' })).toBe(false);
    expect(isCamerasConfigured(camEnv)).toBe(true);
  });

  it('isHomeConfigured is true when EITHER HA or cameras are configured', () => {
    expect(isHomeConfigured({})).toBe(false);
    expect(isHomeConfigured({ HA_BASE_URL: 'http://ha', HA_TOKEN: 't' })).toBe(true);
    expect(isHomeConfigured(camEnv)).toBe(true);
    expect(
      isHomeConfigured({ HA_BASE_URL: 'http://ha', HA_TOKEN: 't', ...camEnv }),
    ).toBe(true);
  });
});

describe('loadHaConfig doorbell entity', () => {
  it('is null when HA_DOORBELL_ENTITY is unset (feature off)', () => {
    expect(loadHaConfig(fakeConfig({})).doorbellEntity).toBeNull();
  });

  it('is null when HA_DOORBELL_ENTITY is blank/whitespace', () => {
    expect(loadHaConfig(fakeConfig({ HA_DOORBELL_ENTITY: '   ' })).doorbellEntity).toBeNull();
  });

  it('carries the trimmed entity id when set', () => {
    const cfg = loadHaConfig(
      fakeConfig({ HA_DOORBELL_ENTITY: '  binary_sensor.front_door_binarysensor ' }),
    );
    expect(cfg.doorbellEntity).toBe('binary_sensor.front_door_binarysensor');
  });
});
