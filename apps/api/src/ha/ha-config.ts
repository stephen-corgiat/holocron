import { ConfigService } from '@nestjs/config';

/**
 * Server-side HA config. `baseUrl` is the LAN URL
 * (`http://<host>:8123`); `token` is the dedicated scoped long-lived token.
 * Both stay in the API config and never reach the tablet.
 *
 * `onList` is the "Currently on" filter: include
 * domains + `state: on`, minus an exclude pattern list. The defaults mirror
 * the household's `auto-entities` card (lights + switches, drop status LEDs).
 */
export const HA_CONFIG = Symbol('HA_CONFIG');

export interface OnListConfig {
  /** Entity domains that count as "on-able" (default `light`, `switch`). */
  includeDomains: string[];
  /**
   * entity_id glob/regex patterns to drop from the on-list (default `*led`).
   * Our matcher escapes dots literally (see on-list-filter.ts) — deliberately
   * NOT auto-entities' quirky dot handling — so `*.led` is not the equivalent;
   * `*led`/`*_led` is. Verify the chosen pattern against the live instance.
   */
  excludePatterns: string[];
}

/**
 * One Scrypted camera. Static config,
 * served as the `cameras` field of the full snapshot — never in live deltas.
 * `urlTemplate` is the unauthenticated `hotlink-ok` snapshot URL (served via
 * HA's reverse proxy) carrying `{ts}`/`{width}` placeholders the tablet fills
 * in; the API touches no image bytes and holds no camera credential.
 */
export interface CameraConfig {
  id: string;
  name: string;
  doorbell?: boolean;
  urlTemplate: string;
}

/**
 * House-fan state→service map. Each tablet state ('off'|'low'|'high')
 * names the HA service to call and any extra body fields beyond `entity_id`.
 * Defaults assume a preset-mode fan (`fan.set_preset_mode` with 'low'/'high',
 * `fan.turn_off`); the exact services must be confirmed against the live fan
 * (it may instead want `fan.set_percentage`) — overridable via `HA_FAN_SERVICES`.
 */
export type FanStateName = 'off' | 'low' | 'high';
export interface FanServiceSpec {
  /** `<domain>.<service>`, e.g. `fan.set_preset_mode` or `fan.turn_off`. */
  service: string;
  /** Extra body fields merged with `{ entity_id }` (e.g. `{ preset_mode: 'low' }`). */
  data?: Record<string, unknown>;
}
export type FanServiceMap = Record<FanStateName, FanServiceSpec>;

/** Scene config: independently-optional button + input_boolean ids. */
export interface ScenesConfig {
  /** `button.*` ids — momentary `button.press`, no state (Clean Kitchen). */
  buttons: string[];
  /** `input_boolean.*` ids — stateful toggle (Night Mode). */
  booleans: string[];
}

export interface HaConfig {
  baseUrl: string;
  token: string;
  onList: OnListConfig;
  /**
   * The read-only doorbell `binary_sensor`, e.g. `binary_sensor.front_door_binarysensor`. Unset ⇒ no
   * doorbell feature at all (per-feature optional). When set, the entity
   * rides the existing `state_changed` WS as a **read-only** addition (it
   * widens the read surface only — never the controllable command surface);
   * its rising edge (`off`→`on`) stamps `HaSnapshot.doorbell.rangAt`.
   */
  doorbellEntity: string | null;
  /** Static Scrypted camera list. Empty ⇒ no camera UI. */
  cameras: CameraConfig[];
  /**
   * The single canonical `{width}` requested from every hotlink URL on every
   * surface: one width = one server-side resize per fresh
   * frame. The `<img>` box downscales per surface — never request per-surface
   * widths.
   */
  snapshotWidth: number;
  /** Each optional per D15 — absent ⇒ no snapshot field, no FE render. */
  climateEntity: string | null;
  fanEntity: string | null;
  fanServices: FanServiceMap;
  weatherEntity: string | null;
  co2Entity: string | null;
  scenes: ScenesConfig;
}

/**
 * Feature gate (HA side): true when the HA control creds are present.
 * Drives whether the HA control panels + WS push exist.
 */
export function isHaConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.HA_BASE_URL && env.HA_TOKEN);
}

/**
 * Feature gate (Scrypted side): true when at least one camera is
 * configured. Independent of {@link isHaConfigured} — cameras can be on with
 * HA off, and vice versa.
 */
export function isCamerasConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return parseCameras(env.SCRYPTED_CAMERAS).length > 0;
}

/**
 * The unified home-surface gate: the `HaModule` is wired — and the
 * `/ha/snapshot` route exists — when **either** HA controls **or** cameras are
 * configured. Both absent ⇒ no module, no routes, no bottom bar (the both-off
 * cascade). Used by `AppModule.register()`.
 */
export function isHomeConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isHaConfigured(env) || isCamerasConfigured(env);
}

const DEFAULT_SNAPSHOT_WIDTH = 768;

/**
 * Parse `SCRYPTED_CAMERAS` — a JSON array of `{ id, name, doorbell?,
 * urlTemplate }`. Tolerant of an unset/blank/malformed value (⇒ `[]`, i.e. no
 * camera UI) so a misconfigured install degrades to "no cameras" rather than a
 * boot crash. No hard-coded ids live here — every camera comes from env.
 */
export function parseCameras(raw: string | undefined): CameraConfig[] {
  if (!raw || raw.trim().length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry): CameraConfig[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { id, name, doorbell, urlTemplate } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || id.length === 0) return [];
    if (typeof urlTemplate !== 'string' || urlTemplate.length === 0) return [];
    return [
      {
        id,
        name: typeof name === 'string' && name.length > 0 ? name : id,
        ...(doorbell === true ? { doorbell: true } : {}),
        urlTemplate,
      },
    ];
  });
}

function splitList(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items;
}

/** A single non-empty config value, or `null` when unset (per-panel gate). */
function optional(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

/**
 * Default fan map (preset-mode fan). Overridable via `HA_FAN_SERVICES` as a
 * JSON object, e.g. `{"low":{"service":"fan.set_percentage","data":{"percentage":33}}}`
 * — any subset is merged over these defaults so a household can tune just one
 * state. Preset names are hardware-specific, so check them against your HA
 * instance.
 */
const DEFAULT_FAN_SERVICES: FanServiceMap = {
  off: { service: 'fan.turn_off' },
  low: { service: 'fan.set_preset_mode', data: { preset_mode: 'low' } },
  high: { service: 'fan.set_preset_mode', data: { preset_mode: 'high' } },
};

function loadFanServices(raw: string | undefined): FanServiceMap {
  const override = optional(raw);
  if (!override) return DEFAULT_FAN_SERVICES;
  try {
    const parsed = JSON.parse(override) as Partial<FanServiceMap>;
    return {
      off: parsed.off ?? DEFAULT_FAN_SERVICES.off,
      low: parsed.low ?? DEFAULT_FAN_SERVICES.low,
      high: parsed.high ?? DEFAULT_FAN_SERVICES.high,
    };
  } catch {
    return DEFAULT_FAN_SERVICES;
  }
}

export function loadHaConfig(config: ConfigService): HaConfig {
  const includeDomains = splitList(config.get<string>('HA_ONLIST_INCLUDE')) ?? [
    'light',
    'switch',
  ];
  // `null` (unset) ⇒ the LED default; an explicit empty string ⇒ no excludes.
  const excludePatterns = splitList(config.get<string>('HA_ONLIST_EXCLUDE')) ?? [
    '*led',
  ];
  const doorbellRaw = config.get<string>('HA_DOORBELL_ENTITY');
  const doorbellEntity =
    typeof doorbellRaw === 'string' && doorbellRaw.trim().length > 0
      ? doorbellRaw.trim()
      : null;
  const widthRaw = config.get<string>('SCRYPTED_SNAPSHOT_WIDTH');
  const widthParsed = widthRaw === undefined ? NaN : Number(widthRaw);
  const snapshotWidth =
    Number.isFinite(widthParsed) && widthParsed > 0
      ? Math.round(widthParsed)
      : DEFAULT_SNAPSHOT_WIDTH;
  return {
    baseUrl: config.get<string>('HA_BASE_URL') ?? '',
    token: config.get<string>('HA_TOKEN') ?? '',
    onList: { includeDomains, excludePatterns },
    doorbellEntity,
    cameras: parseCameras(config.get<string>('SCRYPTED_CAMERAS')),
    snapshotWidth,
    climateEntity: optional(config.get<string>('HA_CLIMATE_ENTITY')),
    fanEntity: optional(config.get<string>('HA_FAN_ENTITY')),
    fanServices: loadFanServices(config.get<string>('HA_FAN_SERVICES')),
    weatherEntity: optional(config.get<string>('HA_WEATHER_ENTITY')),
    co2Entity: optional(config.get<string>('HA_CO2_ENTITY')),
    scenes: {
      buttons: splitList(config.get<string>('HA_SCENE_BUTTONS')) ?? [],
      booleans: splitList(config.get<string>('HA_SCENE_BOOLEANS')) ?? [],
    },
  };
}
