import { slugifyDisplayName } from './slug';

describe('slugifyDisplayName', () => {
  it.each([
    ['Bob', 'bob'],
    ['Carol Reyes', 'carol-reyes'],
    ['  Sarah  Reyes  ', 'sarah-reyes'],
    ['Tom_Reyes', 'tom-reyes'],
    ["O'Brien", 'o-brien'],
    ['Renée', 'renee'],
    ['Müller', 'muller'],
    ['多 Trackee', 'trackee'],
    ['---hyphens---', 'hyphens'],
    ['', ''],
    ['!!!', ''],
  ])('"%s" → "%s"', (input, expected) => {
    expect(slugifyDisplayName(input)).toBe(expected);
  });

  it('does not append a uniqueness suffix when the slug already exists for another Trackee', () => {
    // Slug derivation is pure: two Trackees named "Bob" produce identical slugs.
    // Uniqueness is intentionally NOT enforced — admins resolve collisions in the editor.
    expect(slugifyDisplayName('Bob')).toBe(slugifyDisplayName('Bob'));
  });
});
