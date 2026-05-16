/**
 * FE-facing snapshot shape — small, server-shaped, and free of any Home
 * Assistant types (the tablet never sees raw HA payloads). The full field set
 * is pinned here so the optional blocks (thermostat, fan, weather, CO₂,
 * scenes, doorbell, cameras) share one contract.
 *
 * Every block except `status`/`lights` is **present only when its
 * entity is configured**; absent ⇒ the FE renders nothing. A present block
 * with `avail: 'unavailable'` is the configured-but-offline (dimmed) state.
 */
export type HaStatus = 'ok' | 'stale' | 'disconnected';
export type Avail = 'ok' | 'unavailable';
export type FanState = 'off' | 'low' | 'high';

/** A single "Currently on" row (a light or switch in the `on` state). */
export interface LightView {
  entityId: string;
  name: string;
  /** Short label under the name (e.g. "LIGHT", "SWITCH", a device class). */
  kind: string;
  on: boolean;
}

export interface HaSnapshot {
  /** Whole-integration link health — drives the header pill. */
  status: HaStatus;
  /**
   * Whether HA control creds are configured. False on a cameras-only
   * install: the FE then renders no control panels / no header link pill and
   * shows cameras full-bleed, while still showing the home surface (cameras
   * keep it alive).
   */
  haEnabled: boolean;
  /** "Currently on" list, already filtered to the on-set (baseline panel). */
  lights: LightView[];

  // ── Optional panels (present only when configured) ──
  climate?: {
    // `entityId` rides the snapshot so the tablet can nudge without a
    // hard-coded id; the backend still validates it against config.
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
    // Each carries its `entityId` so the tablet can issue the command without
    // a hard-coded id; the id never round-trips through any code constant.
    cleanKitchen?: { entityId: string; avail: Avail };
    nightMode?: { entityId: string; avail: Avail; on: boolean };
  };
  /** ISO ts of the last doorbell press — an edge event, not steady state. */
  doorbell?: { rangAt: string };
  /** Static camera config — present on the full snapshot, never in deltas. */
  cameras?: { id: string; name: string; doorbell?: boolean; urlTemplate: string }[];
  /**
   * The single canonical `{width}` the FE substitutes into every camera
   * `urlTemplate` on every surface — one width ⇒ one server-side resize
   * per fresh frame. Present iff `cameras` is. Static, never in deltas.
   */
  snapshotWidth?: number;
}

/**
 * A live delta pushed over `ha:state_changed`. It is just a partial snapshot:
 * the WS carries the shaped payload itself so the tablet updates with no
 * follow-up HTTP round-trip (a deliberate divergence from the
 * bare `{at}` nudge events).
 */
export type HaSnapshotDelta = Partial<HaSnapshot>;
