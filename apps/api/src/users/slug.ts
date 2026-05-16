/**
 * Derive a router_id slug from a Trackee's display_name.
 *
 * Slugified ASCII, no uniqueness suffix. Diacritics are
 * stripped (ä → a), non-alphanumerics collapse to single hyphens, leading and
 * trailing hyphens are trimmed, and the result is lower-cased.
 *
 * Returns the empty string when the input has no representable characters
 * — callers should treat empty as "skip router enforcement for this Trackee."
 */
export function slugifyDisplayName(displayName: string): string {
  return displayName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
