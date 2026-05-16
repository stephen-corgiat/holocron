import { HaEntityState } from './ha-http-client';
import { globToMatcher, shapeOnList, affectsOnList } from './on-list-filter';

describe('globToMatcher', () => {
  it('treats * as .* and anchors the whole id', () => {
    const m = globToMatcher('light.*');
    expect(m('light.kitchen')).toBe(true);
    expect(m('switch.kitchen')).toBe(false);
    // anchored: a leading domain must match from the start
    expect(m('x.light.kitchen')).toBe(false);
  });

  it('escapes dots literally (not auto-entities\' quirky handling)', () => {
    // `*.led` under our semantics means "ends in .led" — object_id is `led`.
    const dotted = globToMatcher('*.led');
    expect(dotted('light.led')).toBe(true);
    expect(dotted('light.kitchen_led')).toBe(false); // the auto-entities trap

    // The LED-exclude default `*led` is what actually drops `_led` entities.
    const suffix = globToMatcher('*led');
    expect(suffix('light.kitchen_led')).toBe(true);
    expect(suffix('switch.tv_led')).toBe(true);
    expect(suffix('light.kitchen')).toBe(false);
  });

  it('supports an explicit /regex/ form for power users', () => {
    const m = globToMatcher('/_led$/');
    expect(m('light.kitchen_led')).toBe(true);
    expect(m('light.kitchen')).toBe(false);
  });
});

function state(
  entity_id: string,
  s: string,
  attributes?: HaEntityState['attributes'],
): HaEntityState {
  return { entity_id, state: s, attributes };
}

describe('shapeOnList', () => {
  const config = { includeDomains: ['light', 'switch'], excludePatterns: ['*led'] };

  it('keeps only included domains in the on state, minus excludes', () => {
    const states: HaEntityState[] = [
      state('light.kitchen', 'on', { friendly_name: 'Kitchen' }),
      state('switch.porch', 'on', { friendly_name: 'Porch' }),
      state('light.office', 'off', { friendly_name: 'Office' }), // off → out
      state('light.tv_led', 'on', { friendly_name: 'TV LED' }), // excluded
      state('climate.home', 'on', { friendly_name: 'Thermostat' }), // domain out
      state('sensor.temp', 'on'), // domain out
    ];
    const rows = shapeOnList(states, config);
    expect(rows.map((r) => r.entityId)).toEqual(['light.kitchen', 'switch.porch']);
  });

  it('uses friendly_name, falls back to a humanized object_id, and sorts by name', () => {
    const states: HaEntityState[] = [
      state('switch.back_porch', 'on'), // no friendly_name → "Back Porch"
      state('light.kitchen', 'on', { friendly_name: 'Kitchen Ceiling' }),
    ];
    const rows = shapeOnList(states, config);
    expect(rows.map((r) => r.name)).toEqual(['Back Porch', 'Kitchen Ceiling']);
  });

  it('labels kind from device_class, else the domain', () => {
    const states: HaEntityState[] = [
      state('switch.tv', 'on', { device_class: 'outlet' }),
      state('light.kitchen', 'on'),
    ];
    const byId = Object.fromEntries(
      shapeOnList(states, config).map((r) => [r.entityId, r.kind]),
    );
    expect(byId['switch.tv']).toBe('Outlet');
    expect(byId['light.kitchen']).toBe('Light');
  });

  it('renders the empty set when nothing is on', () => {
    expect(shapeOnList([state('light.kitchen', 'off')], config)).toEqual([]);
  });
});

describe('affectsOnList', () => {
  const config = { includeDomains: ['light', 'switch'], excludePatterns: [] };
  it('is true only for controllable domains', () => {
    expect(affectsOnList('light.kitchen', config)).toBe(true);
    expect(affectsOnList('switch.porch', config)).toBe(true);
    expect(affectsOnList('climate.home', config)).toBe(false);
  });
});
