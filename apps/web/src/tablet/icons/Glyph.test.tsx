import { describe, expect, it } from 'vitest';
import { isKnownGlyph } from './Glyph';
import { LISTED_GLYPHS, LISTED_ICONS } from './registry';

describe('Glyph + registry', () => {
  it('isKnownGlyph reports true for every entry in the registry', () => {
    for (const entry of LISTED_GLYPHS) {
      expect(isKnownGlyph(entry.id)).toBe(true);
    }
  });

  it('isKnownGlyph rejects unknown names and null', () => {
    expect(isKnownGlyph(null)).toBe(false);
    expect(isKnownGlyph(undefined)).toBe(false);
    expect(isKnownGlyph('not-a-glyph')).toBe(false);
    expect(isKnownGlyph('')).toBe(false);
  });

  it('LISTED_GLYPHS has no duplicate ids', () => {
    const ids = LISTED_GLYPHS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('LISTED_ICONS has no duplicate ids', () => {
    const ids = LISTED_ICONS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
