import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HaSnapshot,
  HaSnapshotDelta,
  ProxyHaSource,
  applyHaDelta,
} from './ha-source';

const base: HaSnapshot = {
  status: 'ok',
  haEnabled: true,
  lights: [{ entityId: 'light.kitchen', name: 'Kitchen', kind: 'Light', on: true }],
};

describe('applyHaDelta', () => {
  it('replaces the on-list when a lights delta arrives', () => {
    const next = applyHaDelta(base, { lights: [] });
    expect(next.lights).toEqual([]);
    expect(next.status).toBe('ok'); // untouched
  });

  it('updates status alone without dropping lights', () => {
    const next = applyHaDelta(base, { status: 'disconnected' } as HaSnapshotDelta);
    expect(next.status).toBe('disconnected');
    expect(next.lights).toEqual(base.lights);
  });
});

function mockFetch(impl: (url: string, init?: RequestInit) => Response) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => impl(url, init));
  // @ts-expect-error - jsdom/node global
  globalThis.fetch = fn;
  return fn;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProxyHaSource.getSnapshot', () => {
  it('returns null when /ha routes are absent (404 ⇒ HA disabled)', async () => {
    mockFetch(() => new Response('', { status: 404 }));
    const source = new ProxyHaSource('tok', () => () => {});
    expect(await source.getSnapshot()).toBeNull();
  });

  it('parses the snapshot on 200', async () => {
    mockFetch(() => new Response(JSON.stringify(base), { status: 200 }));
    const source = new ProxyHaSource('tok', () => () => {});
    expect(await source.getSnapshot()).toEqual(base);
  });

  it('throws on other non-ok responses', async () => {
    mockFetch(() => new Response('', { status: 500 }));
    const source = new ProxyHaSource('tok', () => () => {});
    await expect(source.getSnapshot()).rejects.toThrow();
  });
});

describe('ProxyHaSource.toggle', () => {
  it('POSTs the entity + desired state with the bearer token', async () => {
    // 200 not 204 — jsdom's Response ctor rejects a 204; toggle only checks ok.
    const fetchFn = mockFetch(() => new Response('', { status: 200 }));
    const source = new ProxyHaSource('tok', () => () => {});
    await source.toggle('light.kitchen', false);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/ha/toggle');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      entityId: 'light.kitchen',
      on: false,
    });
    expect(
      (init?.headers as Record<string, string>).Authorization,
    ).toBe('Bearer tok');
  });
});

describe('ProxyHaSource commands', () => {
  it('nudgeClimate posts the entity + direction', async () => {
    const fetchFn = mockFetch(() => new Response('', { status: 200 }));
    const source = new ProxyHaSource('tok', () => () => {});
    await source.nudgeClimate('climate.home', 1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/ha/climate/nudge');
    expect(JSON.parse(init?.body as string)).toEqual({
      entityId: 'climate.home',
      dir: 1,
    });
  });

  it('setFan posts the entity + state', async () => {
    const fetchFn = mockFetch(() => new Response('', { status: 200 }));
    const source = new ProxyHaSource('tok', () => () => {});
    await source.setFan('fan.house', 'high');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/ha/fan');
    expect(JSON.parse(init?.body as string)).toEqual({
      entityId: 'fan.house',
      state: 'high',
    });
  });

  it('pressButton hits the encoded button endpoint (no body fields)', async () => {
    const fetchFn = mockFetch(() => new Response('', { status: 200 }));
    const source = new ProxyHaSource('tok', () => () => {});
    await source.pressButton('button.clean_kitchen');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/ha/button/button.clean_kitchen/press');
    expect(init?.method).toBe('POST');
  });

  it('setBoolean hits the encoded boolean endpoint with { on }', async () => {
    const fetchFn = mockFetch(() => new Response('', { status: 200 }));
    const source = new ProxyHaSource('tok', () => () => {});
    await source.setBoolean('input_boolean.night_mode', true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/ha/boolean/input_boolean.night_mode');
    expect(JSON.parse(init?.body as string)).toEqual({ on: true });
  });

  it('throws (fail-soft handled upstream) on a non-ok command', async () => {
    mockFetch(() => new Response('', { status: 403 }));
    const source = new ProxyHaSource('tok', () => () => {});
    await expect(source.setFan('fan.house', 'low')).rejects.toThrow();
  });
});

describe('applyHaDelta merges optional panels whole', () => {
  it('replaces an entire panel block on each delta', () => {
    const withClimate = applyHaDelta(base, {
      climate: {
        entityId: 'climate.home',
        avail: 'ok',
        current: 68,
        target: 70,
        unit: '°F',
      },
    });
    expect(withClimate.climate?.target).toBe(70);
    expect(withClimate.lights).toEqual(base.lights); // untouched
    const cooler = applyHaDelta(withClimate, {
      climate: {
        entityId: 'climate.home',
        avail: 'ok',
        current: 68,
        target: 69,
        unit: '°F',
      },
    });
    expect(cooler.climate?.target).toBe(69);
  });
});

describe('ProxyHaSource.subscribe', () => {
  it('listens on ha:state_changed and forwards the delta minus the `at` envelope', () => {
    let handler: ((payload: unknown) => void) | null = null;
    const unsub = vi.fn();
    const source = new ProxyHaSource('tok', (event, h) => {
      expect(event).toBe('ha:state_changed');
      handler = h;
      return unsub;
    });

    const seen: HaSnapshotDelta[] = [];
    const off = source.subscribe((d) => seen.push(d));
    expect(handler).not.toBeNull();

    handler!({ at: '2026-05-31T00:00:00.000Z', status: 'ok', lights: [] });
    expect(seen).toEqual([{ status: 'ok', lights: [] }]);

    off();
    expect(unsub).toHaveBeenCalled();
  });
});
