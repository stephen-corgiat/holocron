import { describe, expect, it } from 'vitest';
import { co2Tint } from './HomeDock';

/**
 * Pure panel logic. The web suite has no DOM renderer (matching the project
 * convention — render coverage is e2e), so we unit-test the threshold math
 * that the dock's CO₂ readout tint depends on.
 */
describe('co2Tint thresholds', () => {
  it('is ink below 800 (good)', () => {
    expect(co2Tint(0)).toBe('var(--tb-ink)');
    expect(co2Tint(612)).toBe('var(--tb-ink)');
    expect(co2Tint(799)).toBe('var(--tb-ink)');
  });

  it('is amber from 800 to 1199 (elevated)', () => {
    expect(co2Tint(800)).toBe('var(--tb-warn)');
    expect(co2Tint(1199)).toBe('var(--tb-warn)');
  });

  it('is red at 1200 and above (high)', () => {
    expect(co2Tint(1200)).toBe('var(--tb-danger)');
    expect(co2Tint(5000)).toBe('var(--tb-danger)');
  });
});
