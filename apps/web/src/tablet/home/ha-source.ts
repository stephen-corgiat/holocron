// The tablet's view of the home surface. Small, FE-owned, and free of any
// Home Assistant types — the backend shapes everything and
// the tablet only ever sees this. `status` + `lights` are always present;
// the optional blocks are pinned here so each panel shares one seam.

export type HaStatus = 'ok' | 'stale' | 'disconnected';
export type Avail = 'ok' | 'unavailable';
export type FanState = 'off' | 'low' | 'high';

export interface LightView {
  entityId: string;
  name: string;
  kind: string;
  on: boolean;
}

export interface HaSnapshot {
  status: HaStatus;
  /** True when HA control creds are configured; false on a cameras-only install. */
  haEnabled: boolean;
  lights: LightView[];
  // ── Optional panels (present only when configured) ──
  climate?: {
    entityId: string;
    avail: Avail;
    current: number;
    target: number;
    action?: 'heating' | 'cooling' | 'idle';
    unit: '°F' | '°C';
  };
  fan?: { entityId: string; avail: Avail; state: FanState };
  weather?: {
    avail: Avail;
    tempNow?: number;
    condition?: string;
    tempLow?: number;
    tempHigh?: number;
  };
  co2?: { avail: Avail; ppm?: number };
  scenes?: {
    cleanKitchen?: { entityId: string; avail: Avail };
    nightMode?: { entityId: string; avail: Avail; on: boolean };
  };
  doorbell?: { rangAt: string };
  cameras?: CameraView[];
  /**
   * The single canonical `{width}` to substitute into every camera
   * `urlTemplate` on every surface. Present iff `cameras` is.
   */
  snapshotWidth?: number;
}

/** One configured Scrypted camera (static snapshot config). */
export interface CameraView {
  id: string;
  name: string;
  doorbell?: boolean;
  /** Unauthenticated hotlink snapshot URL with `{ts}`/`{width}` placeholders. */
  urlTemplate: string;
}

export type HaSnapshotDelta = Partial<HaSnapshot>;

/**
 * The seam the home-surface UI talks to. Only
 * `ProxyHaSource` is built — the seam stays as clean internal structure and a
 * test seam, not as multi-shell insurance.
 */
export interface HaSource {
  /** Initial full snapshot, or `null` when HA is not configured (404). */
  getSnapshot(): Promise<HaSnapshot | null>;
  toggle(entityId: string, on: boolean): Promise<void>;
  /** Thermostat ±: the tablet only sends a direction; the server clamps. */
  nudgeClimate(entityId: string, dir: 1 | -1): Promise<void>;
  /** House fan Off/Low/High (server maps via its state→service map). */
  setFan(entityId: string, state: FanState): Promise<void>;
  /** Momentary scene action — `button.press`, fire-and-forget (Clean Kitchen). */
  pressButton(entityId: string): Promise<void>;
  /** Stateful scene toggle — input_boolean on/off (Night Mode). */
  setBoolean(entityId: string, on: boolean): Promise<void>;
  /** Live deltas over the existing socket; returns an unsubscribe fn. */
  subscribe(cb: (delta: HaSnapshotDelta) => void): () => void;
}

/**
 * Fold a live `ha:state_changed` delta into the current snapshot. The backend
 * emits each block whole (the full on-list, the whole climate block, …), so a
 * shallow merge is correct and total. Pure — the hook's only state reducer.
 */
export function applyHaDelta(prev: HaSnapshot, delta: HaSnapshotDelta): HaSnapshot {
  return { ...prev, ...delta };
}

type SubscribeFn = (event: string, handler: (payload: unknown) => void) => () => void;

/**
 * REST to Holocron's `/ha/*` endpoints + the existing socket.io for live
 * deltas. No `home-assistant-js-websocket` on the tablet — the tablet
 * only knows this small shape and the one socket event.
 */
export class ProxyHaSource implements HaSource {
  constructor(
    private readonly token: string,
    private readonly subscribeToEvent: SubscribeFn,
  ) {}

  private authHeaders(json = false): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  async getSnapshot(): Promise<HaSnapshot | null> {
    const res = await fetch('/api/ha/snapshot', { headers: this.authHeaders() });
    // No /ha routes ⇒ HA is unconfigured ⇒ hide the whole home surface.
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`ha snapshot failed: ${res.status}`);
    return (await res.json()) as HaSnapshot;
  }

  private async command(path: string, body: unknown): Promise<void> {
    const res = await fetch(`/api/ha/${path}`, {
      method: 'POST',
      headers: this.authHeaders(true),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`ha ${path} failed: ${res.status}`);
  }

  toggle(entityId: string, on: boolean): Promise<void> {
    return this.command('toggle', { entityId, on });
  }

  nudgeClimate(entityId: string, dir: 1 | -1): Promise<void> {
    return this.command('climate/nudge', { entityId, dir });
  }

  setFan(entityId: string, state: FanState): Promise<void> {
    return this.command('fan', { entityId, state });
  }

  pressButton(entityId: string): Promise<void> {
    return this.command(`button/${encodeURIComponent(entityId)}/press`, {});
  }

  setBoolean(entityId: string, on: boolean): Promise<void> {
    return this.command(`boolean/${encodeURIComponent(entityId)}`, { on });
  }

  subscribe(cb: (delta: HaSnapshotDelta) => void): () => void {
    return this.subscribeToEvent('ha:state_changed', (payload) => {
      // The event carries the shaped delta itself; drop the `at` envelope key.
      const { at: _at, ...delta } = (payload ?? {}) as Record<string, unknown>;
      void _at;
      cb(delta as HaSnapshotDelta);
    });
  }
}
