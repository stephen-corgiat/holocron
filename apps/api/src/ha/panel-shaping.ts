import { HaEntityState } from './ha-http-client';
import { HaConfig } from './ha-config';
import { Avail, FanState, HaSnapshot } from './ha-snapshot';

/**
 * Pure shaping for the optional home panels: fold the relevant HA
 * entity state into each `HaSnapshot` block. Each helper returns `undefined`
 * when the panel is **not configured** (no field ⇒ FE renders nothing), and a
 * block with `avail: 'unavailable'` when configured-but-offline. Shared by the
 * full snapshot and the live delta so the two can never diverge.
 *
 * The weather forecast (condition/low/high) is NOT shaped here — it comes from
 * the cached `weather.get_forecasts` slow poll (see `weather-forecast.ts`) and
 * is folded in alongside the live `temperature` attribute.
 */

const HA_UNAVAILABLE = new Set(['unavailable', 'unknown']);

function isOffline(state: HaEntityState | undefined): state is undefined {
  return !state || HA_UNAVAILABLE.has(state.state);
}

function attrNumber(
  state: HaEntityState,
  key: string,
): number | undefined {
  const v = state.attributes?.[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return undefined;
}

// ── Thermostat ───────────────────────────────────────────────────────────────

/** Clamp a candidate setpoint to the entity's [min,max] grid, rounded to step. */
export function clampSetpoint(
  candidate: number,
  min: number,
  max: number,
  step: number,
): number {
  const clamped = Math.min(max, Math.max(min, candidate));
  if (!(step > 0)) return clamped;
  // Round to the nearest step relative to `min` so the grid stays aligned,
  // then re-clamp (rounding can nudge past an edge for non-integer steps).
  const snapped = min + Math.round((clamped - min) / step) * step;
  // Avoid binary-float fuzz like 70.30000000000001.
  const rounded = Math.round(snapped * 1000) / 1000;
  return Math.min(max, Math.max(min, rounded));
}

/** The clamp parameters read off a climate entity, with sane fallbacks. */
export interface ClimateBounds {
  min: number;
  max: number;
  step: number;
}

export function climateBounds(state: HaEntityState): ClimateBounds {
  return {
    min: attrNumber(state, 'min_temp') ?? 45,
    max: attrNumber(state, 'max_temp') ?? 95,
    step: attrNumber(state, 'target_temp_step') ?? 1,
  };
}

function climateAction(
  raw: unknown,
): 'heating' | 'cooling' | 'idle' | undefined {
  if (raw === 'heating' || raw === 'cooling' || raw === 'idle') return raw;
  return undefined;
}

function climateUnit(state: HaEntityState): '°F' | '°C' {
  const unit = state.attributes?.['temperature_unit'];
  return unit === '°C' || unit === 'C' ? '°C' : '°F';
}

export function shapeClimate(
  entityId: string | null,
  state: HaEntityState | undefined,
): HaSnapshot['climate'] {
  if (!entityId) return undefined;
  if (isOffline(state)) {
    return { entityId, avail: 'unavailable', current: 0, target: 0, unit: '°F' };
  }
  const current = attrNumber(state, 'current_temperature');
  const target = attrNumber(state, 'temperature');
  return {
    entityId,
    avail: 'ok',
    current: current ?? 0,
    target: target ?? 0,
    action: climateAction(state.attributes?.['hvac_action']),
    unit: climateUnit(state),
  };
}

// ── House fan ─────────────────────────────────────────────────────────────────

/**
 * Map the live HA fan state onto the segmented Off/Low/High the tablet shows.
 * `off`/`unavailable`/`unknown` ⇒ off; otherwise the `preset_mode` attribute
 * (or `percentage`) decides low vs high. This is the read side; the command
 * side uses the configured `fanServices` state→service map.
 */
export function fanStateOf(state: HaEntityState): FanState {
  if (state.state !== 'on') return 'off';
  const preset = state.attributes?.['preset_mode'];
  if (typeof preset === 'string') {
    const p = preset.toLowerCase();
    if (p.includes('high') || p.includes('max')) return 'high';
    if (p.includes('low') || p.includes('min')) return 'low';
  }
  const pct = attrNumber(state, 'percentage');
  if (typeof pct === 'number') return pct >= 66 ? 'high' : 'low';
  // On but indeterminate level → treat as high (running, full).
  return 'high';
}

export function shapeFan(
  entityId: string | null,
  state: HaEntityState | undefined,
): HaSnapshot['fan'] {
  if (!entityId) return undefined;
  if (isOffline(state)) return { entityId, avail: 'unavailable', state: 'off' };
  return { entityId, avail: 'ok', state: fanStateOf(state) };
}

// ── CO₂ ────────────────────────────────────────────────────────────────────────

export function shapeCo2(
  entityId: string | null,
  state: HaEntityState | undefined,
): HaSnapshot['co2'] {
  if (!entityId) return undefined;
  if (isOffline(state)) return { avail: 'unavailable' };
  const ppm = Number(state.state);
  return Number.isNaN(ppm)
    ? { avail: 'unavailable' }
    : { avail: 'ok', ppm };
}

// ── Scenes ───────────────────────────────────────────────────────────────────

function sceneAvail(state: HaEntityState | undefined): Avail {
  return isOffline(state) ? 'unavailable' : 'ok';
}

export function shapeScenes(
  config: HaConfig,
  byId: (entityId: string) => HaEntityState | undefined,
): HaSnapshot['scenes'] {
  const buttonId = config.scenes.buttons[0];
  const booleanId = config.scenes.booleans[0];
  if (!buttonId && !booleanId) return undefined;
  const scenes: NonNullable<HaSnapshot['scenes']> = {};
  if (buttonId) {
    scenes.cleanKitchen = { entityId: buttonId, avail: sceneAvail(byId(buttonId)) };
  }
  if (booleanId) {
    const state = byId(booleanId);
    scenes.nightMode = {
      entityId: booleanId,
      avail: sceneAvail(state),
      on: state?.state === 'on',
    };
  }
  return scenes;
}

// ── Combined fold ──────────────────────────────────────────────────────────────

/**
 * Fold every configured control/sensor panel (everything except `weather`'s
 * forecast, which is supplied separately) into a snapshot fragment. Absent
 * entities are simply skipped (no field).
 */
export function shapePanels(
  config: HaConfig,
  byId: (entityId: string) => HaEntityState | undefined,
): Pick<HaSnapshot, 'climate' | 'fan' | 'co2' | 'scenes'> {
  const out: Pick<HaSnapshot, 'climate' | 'fan' | 'co2' | 'scenes'> = {};
  const climate = shapeClimate(
    config.climateEntity,
    config.climateEntity ? byId(config.climateEntity) : undefined,
  );
  if (climate) out.climate = climate;
  const fan = shapeFan(
    config.fanEntity,
    config.fanEntity ? byId(config.fanEntity) : undefined,
  );
  if (fan) out.fan = fan;
  const co2 = shapeCo2(
    config.co2Entity,
    config.co2Entity ? byId(config.co2Entity) : undefined,
  );
  if (co2) out.co2 = co2;
  const scenes = shapeScenes(config, byId);
  if (scenes) out.scenes = scenes;
  return out;
}

/** True when a changed entity could affect any configured non-light panel. */
export function affectsPanels(entityId: string, config: HaConfig): boolean {
  return (
    entityId === config.climateEntity ||
    entityId === config.fanEntity ||
    entityId === config.co2Entity ||
    entityId === config.weatherEntity ||
    config.scenes.buttons.includes(entityId) ||
    config.scenes.booleans.includes(entityId)
  );
}
