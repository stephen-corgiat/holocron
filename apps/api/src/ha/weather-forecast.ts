import { HaEntityState } from './ha-http-client';
import { HaSnapshot } from './ha-snapshot';

/**
 * The slice of today's forecast we keep — pulled from the cached
 * `weather.get_forecasts` response on a slow timer. The
 * call returns HA's **own cached** forecast, so polling is quota-free; the
 * user accepts hours-stale, hence the relaxed interval (default ~20 min).
 */
export interface ForecastToday {
  condition?: string;
  tempLow?: number;
  tempHigh?: number;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return undefined;
}

/**
 * Parse HA's `weather.get_forecasts` response for an entity into today's
 * condition + low/high. HA returns
 * `{ service_response: { <entity_id>: { forecast: [{ condition, templow,
 * temperature, ... }, ...] } } }` (the first entry is the nearest/today).
 * Returns `null` if the shape is unrecognized.
 */
export function parseForecast(
  raw: unknown,
  entityId: string,
): ForecastToday | null {
  const root = (raw ?? {}) as Record<string, unknown>;
  // Accept both the wrapped `{ service_response: {...} }` and a bare map.
  const responses = (root.service_response ?? root) as Record<string, unknown>;
  const entry = responses?.[entityId] as Record<string, unknown> | undefined;
  const forecast = entry?.forecast;
  if (!Array.isArray(forecast) || forecast.length === 0) return null;
  const today = forecast[0] as Record<string, unknown>;
  return {
    condition: typeof today.condition === 'string' ? today.condition : undefined,
    tempLow: num(today.templow),
    tempHigh: num(today.temperature),
  };
}

/** Title-case an HA condition slug like `partlycloudy` → `Partly Cloudy`. */
export function humanizeCondition(condition: string | undefined): string | undefined {
  if (!condition) return undefined;
  const spaced = condition
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  return spaced
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const HA_UNAVAILABLE = new Set(['unavailable', 'unknown']);

function attrNumber(state: HaEntityState, key: string): number | undefined {
  return num(state.attributes?.[key]);
}

/**
 * Shape the `weather` block: live current temp from the entity's `temperature`
 * attribute (rides `state_changed`) combined with the cached forecast's
 * condition/low/high. `undefined` ⇒ not configured (no render). A configured
 * entity that is offline/unknown ⇒ `avail: 'unavailable'` (the "No weather
 * data" treatment); present-but-thin renders the same no-data fallback FE-side.
 */
export function shapeWeather(
  entityId: string | null,
  state: HaEntityState | undefined,
  forecast: ForecastToday | null,
): HaSnapshot['weather'] {
  if (!entityId) return undefined;
  if (!state || HA_UNAVAILABLE.has(state.state)) {
    return { avail: 'unavailable' };
  }
  return {
    avail: 'ok',
    tempNow: attrNumber(state, 'temperature'),
    condition: humanizeCondition(forecast?.condition) ?? humanizeCondition(state.state),
    tempLow: forecast?.tempLow,
    tempHigh: forecast?.tempHigh,
  };
}
