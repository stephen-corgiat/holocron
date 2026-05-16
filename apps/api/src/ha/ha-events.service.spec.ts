import { HaEventsService } from './ha-events.service';
import { HaStateStore } from './ha-state-store';
import { HaConfig } from './ha-config';
import { HaHttpClient, HaEntityState } from './ha-http-client';
import { HaEventSource, HaStateChange } from './ha-event-source';
import type { RealtimeBus, RealtimeEvent } from '../realtime/realtime-bus';

/**
 * Folding HA's `state_changed` stream into shaped `ha:state_changed` deltas,
 * with the doorbell rising-edge as its own one-shot nudge.
 * These tests drive the events service through a controllable
 * {@link FakeSource} (the same seam e2e uses) and capture every emitted delta.
 */

const DOORBELL = 'binary_sensor.front_door_binarysensor';

class FakeSource implements HaEventSource {
  changeCb: (c: HaStateChange) => void = () => {};
  statusCb: (s: 'ok' | 'stale' | 'disconnected') => void = () => {};
  started = false;
  onChange(cb: (c: HaStateChange) => void): void {
    this.changeCb = cb;
  }
  onStatus(cb: (s: 'ok' | 'stale' | 'disconnected') => void): void {
    this.statusCb = cb;
  }
  start(): void {
    this.started = true;
    this.statusCb('ok');
  }
  stop(): void {
    this.started = false;
  }
  fire(change: HaStateChange): void {
    this.changeCb(change);
  }
}

class FakeHttp implements HaHttpClient {
  states: HaEntityState[] = [];
  async getStates(): Promise<HaEntityState[]> {
    return this.states;
  }
  async callService(): Promise<void> {
    /* unused here */
  }
  async callServiceWithResponse(): Promise<unknown> {
    return {};
  }
}

function on(entityId: string): HaStateChange {
  return { entityId, newState: { entity_id: entityId, state: 'on' } };
}
function off(entityId: string): HaStateChange {
  return { entityId, newState: { entity_id: entityId, state: 'off' } };
}

function makeService(opts: { doorbellEntity: string | null }) {
  const store = new HaStateStore();
  const source = new FakeSource();
  const http = new FakeHttp();
  const emitted: RealtimeEvent[] = [];
  const bus: Pick<RealtimeBus, 'emit'> = {
    emit: (event: RealtimeEvent) => emitted.push(event),
  };
  const config: HaConfig = {
    baseUrl: 'http://ha.test',
    token: 'tok',
    onList: { includeDomains: ['light', 'switch'], excludePatterns: [] },
    doorbellEntity: opts.doorbellEntity,
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
  const service = new HaEventsService(
    source,
    http,
    config,
    store,
    bus as RealtimeBus,
  );
  return { service, source, store, emitted };
}

function doorbellDeltas(emitted: RealtimeEvent[]): { rangAt: string }[] {
  return emitted.flatMap((e) =>
    e.kind === 'ha:state_changed' && e.delta.doorbell
      ? [e.delta.doorbell as { rangAt: string }]
      : [],
  );
}

describe('HaEventsService — doorbell rising edge', () => {
  it('stamps doorbell.rangAt as its own delta on the off→on edge', () => {
    const { service, source, emitted } = makeService({ doorbellEntity: DOORBELL });
    service.onModuleInit();
    // Seed prior state as off (the resting state of the press sensor).
    source.fire(off(DOORBELL));
    emitted.length = 0;

    source.fire(on(DOORBELL));

    const rings = doorbellDeltas(emitted);
    expect(rings).toHaveLength(1);
    expect(typeof rings[0].rangAt).toBe('string');
    expect(Number.isNaN(Date.parse(rings[0].rangAt))).toBe(false);
  });

  it('rising from an unseen entity (no prior state) still counts as a press', () => {
    const { service, source, emitted } = makeService({ doorbellEntity: DOORBELL });
    service.onModuleInit();
    source.fire(on(DOORBELL)); // first time we ever see it
    expect(doorbellDeltas(emitted)).toHaveLength(1);
  });

  it('does NOT re-fire while the ~15s pulse holds steady on (on→on)', () => {
    const { service, source, emitted } = makeService({ doorbellEntity: DOORBELL });
    service.onModuleInit();
    source.fire(on(DOORBELL));
    emitted.length = 0;
    // A duplicate `on` during the pulse window — no new rising edge.
    source.fire(on(DOORBELL));
    expect(doorbellDeltas(emitted)).toHaveLength(0);
  });

  it('re-fires on a second press after the sensor falls back to off', () => {
    const { service, source, emitted } = makeService({ doorbellEntity: DOORBELL });
    service.onModuleInit();
    source.fire(on(DOORBELL)); // press 1
    source.fire(off(DOORBELL)); // pulse ends
    emitted.length = 0;
    source.fire(on(DOORBELL)); // press 2
    expect(doorbellDeltas(emitted)).toHaveLength(1);
  });

  it('ignores the falling edge (on→off) entirely', () => {
    const { service, source, emitted } = makeService({ doorbellEntity: DOORBELL });
    service.onModuleInit();
    source.fire(on(DOORBELL));
    emitted.length = 0;
    source.fire(off(DOORBELL));
    expect(doorbellDeltas(emitted)).toHaveLength(0);
  });

  it('does nothing for the doorbell when no doorbell entity is configured', () => {
    const { service, source, emitted } = makeService({ doorbellEntity: null });
    service.onModuleInit();
    source.fire(on(DOORBELL));
    expect(doorbellDeltas(emitted)).toHaveLength(0);
  });

  it('does not treat an unrelated binary_sensor as the doorbell', () => {
    const { service, source, emitted } = makeService({ doorbellEntity: DOORBELL });
    service.onModuleInit();
    source.fire(on('binary_sensor.front_door_smart_motion_sensor_motionsensor'));
    expect(doorbellDeltas(emitted)).toHaveLength(0);
  });

  it('keeps the doorbell out of the Currently-On list (its own delta only)', () => {
    const { service, source, emitted } = makeService({ doorbellEntity: DOORBELL });
    service.onModuleInit();
    source.fire(on(DOORBELL));
    // No emitted delta should carry both a doorbell ring and lights together;
    // and the doorbell delta itself carries no `lights` key.
    const ring = emitted.find(
      (e) => e.kind === 'ha:state_changed' && e.delta.doorbell,
    );
    expect(ring).toBeDefined();
    expect(
      ring && ring.kind === 'ha:state_changed' ? ring.delta.lights : 'sentinel',
    ).toBeUndefined();
  });
});
