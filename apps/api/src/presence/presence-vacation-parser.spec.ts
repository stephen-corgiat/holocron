import { parseVacationsBlock } from './presence-vacation-parser';

describe('parseVacationsBlock', () => {
  it('parses a single valid line', () => {
    const { entries, errors } = parseVacationsBlock('5/18/26 - 5/22/26: Summer camp');
    expect(errors).toHaveLength(0);
    expect(entries).toEqual([
      { start: '2026-05-18', end: '2026-05-22', label: 'Summer camp' },
    ]);
  });

  it('parses multiple valid lines', () => {
    const text = [
      '5/18/26 - 5/22/26: Summer camp',
      '6/3/26 - 6/6/26: Work trip · NYC',
      '12/24/26 - 12/26/26: Christmas',
    ].join('\n');
    const { entries, errors } = parseVacationsBlock(text);
    expect(errors).toHaveLength(0);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ start: '2026-05-18', end: '2026-05-22', label: 'Summer camp' });
    expect(entries[1]).toEqual({ start: '2026-06-03', end: '2026-06-06', label: 'Work trip · NYC' });
    expect(entries[2]).toEqual({ start: '2026-12-24', end: '2026-12-26', label: 'Christmas' });
  });

  it('skips blank and whitespace-only lines', () => {
    const text = '\n5/18/26 - 5/22/26: Summer camp\n\n   \n6/3/26 - 6/6/26: NYC\n';
    const { entries, errors } = parseVacationsBlock(text);
    expect(errors).toHaveLength(0);
    expect(entries).toHaveLength(2);
  });

  it('supports single-day windows (same start and end)', () => {
    const { entries, errors } = parseVacationsBlock('7/4/26 - 7/4/26: Independence Day');
    expect(errors).toHaveLength(0);
    expect(entries[0]).toEqual({ start: '2026-07-04', end: '2026-07-04', label: 'Independence Day' });
  });

  it('produces a parse error for lines missing the separator', () => {
    const { entries, errors } = parseVacationsBlock('8/12/26 -- 8/19/26: Cabin');
    expect(entries).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(1);
    expect(errors[0].message).toMatch(/separator/);
  });

  it('produces a parse error for lines with no colon-label', () => {
    const { entries, errors } = parseVacationsBlock('8/12/26 - 8/19/26');
    expect(entries).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(1);
    expect(errors[0].message).toMatch(/separator|colon/);
  });

  it('produces a parse error for an invalid start date', () => {
    const { entries, errors } = parseVacationsBlock('13/1/26 - 5/22/26: Bad month');
    expect(entries).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/start date/);
  });

  it('produces a parse error when start > end', () => {
    const { entries, errors } = parseVacationsBlock('9/1/26 - 8/1/26: Reversed');
    expect(entries).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/after end/);
  });

  it('handles mixed valid and invalid lines, reporting correct line numbers', () => {
    const text = [
      '5/18/26 - 5/22/26: Summer camp', // line 1 — ok
      '7/4/26-7/5/26 Independence Day',  // line 2 — missing " - " separator
      '6/3/26 - 6/6/26: Work trip',      // line 3 — ok
    ].join('\n');
    const { entries, errors } = parseVacationsBlock(text);
    expect(entries).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(2);
  });

  it('returns empty result for empty string', () => {
    const { entries, errors } = parseVacationsBlock('');
    expect(entries).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('two-digit year 26 maps to 2026', () => {
    const { entries } = parseVacationsBlock('1/1/26 - 1/3/26: New Year');
    expect(entries[0].start).toBe('2026-01-01');
  });

  it('trims leading/trailing whitespace from labels', () => {
    const { entries } = parseVacationsBlock('5/18/26 - 5/22/26:  Space trip  ');
    expect(entries[0].label).toBe('Space trip');
  });
});
