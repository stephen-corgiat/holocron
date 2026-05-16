import { HaEntityState } from './ha-http-client';
import { OnListConfig } from './ha-config';
import { LightView } from './ha-snapshot';

/**
 * Our **own** documented entity_id matcher. Deliberately NOT a byte-emulation of
 * `auto-entities`' quirky, version-dependent dot handling:
 *
 *  - `*` → `.*`
 *  - every other regex metacharacter (including `.`) is escaped literally
 *  - anchored `^…$`
 *
 * So `*led` means "entity_id ends in `led`" and `light.*` means "any light".
 * A `/regex/` form is accepted for power users (passed through verbatim).
 */
export function globToMatcher(pattern: string): (entityId: string) => boolean {
  if (pattern.length >= 2 && pattern.startsWith('/') && pattern.endsWith('/')) {
    const re = new RegExp(pattern.slice(1, -1));
    return (entityId) => re.test(entityId);
  }
  const escaped = pattern
    // Escape regex specials EXCEPT `*` (handled next). Dots become literal.
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  const re = new RegExp(`^${escaped}$`);
  return (entityId) => re.test(entityId);
}

function domainOf(entityId: string): string {
  const dot = entityId.indexOf('.');
  return dot === -1 ? entityId : entityId.slice(0, dot);
}

function objectIdOf(entityId: string): string {
  const dot = entityId.indexOf('.');
  return dot === -1 ? entityId : entityId.slice(dot + 1);
}

function titleCase(s: string): string {
  return s
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Friendly name from HA, else a humanized object_id. */
function nameOf(s: HaEntityState): string {
  const friendly = s.attributes?.friendly_name;
  if (typeof friendly === 'string' && friendly.trim().length > 0) {
    return friendly;
  }
  return titleCase(objectIdOf(s.entity_id));
}

/** Short kind label: a switch's device_class, else the domain title-cased. */
function kindOf(s: HaEntityState): string {
  const deviceClass = s.attributes?.device_class;
  if (typeof deviceClass === 'string' && deviceClass.trim().length > 0) {
    return titleCase(deviceClass);
  }
  return titleCase(domainOf(s.entity_id));
}

/**
 * Shape the "Currently on" list: keep entities whose domain is in the include
 * set AND `state === 'on'`, minus anything matching an exclude pattern. Sorted
 * by friendly name for a stable, readable list. Pure — shared by both the
 * full snapshot and the live delta so the two can never diverge.
 */
export function shapeOnList(
  states: HaEntityState[],
  config: OnListConfig,
): LightView[] {
  const include = new Set(config.includeDomains);
  const excludes = config.excludePatterns.map(globToMatcher);
  return states
    .filter((s) => include.has(domainOf(s.entity_id)))
    .filter((s) => s.state === 'on')
    .filter((s) => !excludes.some((match) => match(s.entity_id)))
    .map((s) => ({
      entityId: s.entity_id,
      name: nameOf(s),
      kind: kindOf(s),
      on: true,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** True when a changed entity could affect the on-list (cheap relevance gate). */
export function affectsOnList(entityId: string, config: OnListConfig): boolean {
  return config.includeDomains.includes(domainOf(entityId));
}
