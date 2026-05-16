import { expand } from './engine';
import { RecurrencePattern } from './types';

const d = (s: string) => {
  // 'YYYY-MM-DD' → local-midnight Date.
  const [y, m, day] = s.split('-').map(Number);
  return new Date(y, m - 1, day);
};

const isoDays = (occurrences: { date: Date }[]) =>
  occurrences.map((o) => {
    const y = o.date.getFullYear();
    const m = String(o.date.getMonth() + 1).padStart(2, '0');
    const dd = String(o.date.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  });

describe('recurrence engine — preset table', () => {
  // 2026-05-11 is a Monday.
  const monRange = { from: d('2026-05-11'), to: d('2026-05-17') };

  const cases: Array<{
    label: string;
    pattern: RecurrencePattern;
    range: { from: Date; to: Date };
    expected: string[];
  }> = [
    {
      label: 'daily expands every day in the range',
      pattern: { preset: 'daily' },
      range: monRange,
      expected: [
        '2026-05-11',
        '2026-05-12',
        '2026-05-13',
        '2026-05-14',
        '2026-05-15',
        '2026-05-16',
        '2026-05-17',
      ],
    },
    {
      label: 'weekdays skips Sat/Sun',
      pattern: { preset: 'weekdays' },
      range: monRange,
      expected: [
        '2026-05-11',
        '2026-05-12',
        '2026-05-13',
        '2026-05-14',
        '2026-05-15',
      ],
    },
    {
      label: 'weekends includes Sat+Sun only',
      pattern: { preset: 'weekends' },
      range: monRange,
      expected: ['2026-05-16', '2026-05-17'],
    },
    {
      label: 'weekly on Mon+Wed picks just those days',
      pattern: { preset: 'weekly', days: [1, 3] },
      range: monRange,
      expected: ['2026-05-11', '2026-05-13'],
    },
    {
      label: 'biweekly fires on the anchor week and skips the next',
      pattern: {
        preset: 'biweekly',
        days: [1],
        anchor: '2026-05-11',
      },
      range: { from: d('2026-05-11'), to: d('2026-05-31') },
      expected: ['2026-05-11', '2026-05-25'],
    },
    {
      label: 'every_n_days at n=3 from anchor',
      pattern: { preset: 'every_n_days', n: 3, anchor: '2026-05-11' },
      range: { from: d('2026-05-11'), to: d('2026-05-20') },
      expected: ['2026-05-11', '2026-05-14', '2026-05-17', '2026-05-20'],
    },
    {
      label: 'every_n_weeks at n=3 on Wednesdays',
      pattern: {
        preset: 'every_n_weeks',
        n: 3,
        days: [3],
        anchor: '2026-05-13',
      },
      range: { from: d('2026-05-01'), to: d('2026-07-15') },
      expected: ['2026-05-13', '2026-06-03', '2026-06-24', '2026-07-15'],
    },
    {
      label: 'every_n_months at n=2 anchored on the 15th',
      pattern: {
        preset: 'every_n_months',
        n: 2,
        day_of_month: 15,
        anchor: '2026-01-15',
      },
      range: { from: d('2026-01-01'), to: d('2026-07-31') },
      expected: ['2026-01-15', '2026-03-15', '2026-05-15', '2026-07-15'],
    },
    {
      label: 'yearly_on_date fires once per year on the matching date',
      pattern: { preset: 'yearly_on_date', month: 7, day: 4 },
      range: { from: d('2026-01-01'), to: d('2028-12-31') },
      expected: ['2026-07-04', '2027-07-04', '2028-07-04'],
    },
    {
      label: 'yearly_in_month picks the first Saturday of June',
      pattern: {
        preset: 'yearly_in_month',
        month: 6,
        ordinal: 1,
        day_of_week: 6,
      },
      range: { from: d('2026-01-01'), to: d('2028-12-31') },
      expected: ['2026-06-06', '2027-06-05', '2028-06-03'],
    },
    {
      label: 'yearly_in_month picks the last Monday of May (Memorial Day)',
      pattern: {
        preset: 'yearly_in_month',
        month: 5,
        ordinal: -1,
        day_of_week: 1,
      },
      range: { from: d('2026-01-01'), to: d('2028-12-31') },
      expected: ['2026-05-25', '2027-05-31', '2028-05-29'],
    },
  ];

  it.each(cases)('$label', ({ pattern, range, expected }) => {
    expect(isoDays(expand(pattern, range))).toEqual(expected);
  });
});

describe('recurrence engine — edge cases', () => {
  it('daily across DST spring-forward keeps one occurrence per local day', () => {
    // US DST 2026 spring forward: 2026-03-08 (clocks jump 02:00→03:00).
    const range = { from: d('2026-03-07'), to: d('2026-03-09') };
    expect(isoDays(expand({ preset: 'daily' }, range))).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
    ]);
  });

  it('daily across DST fall-back keeps one occurrence per local day', () => {
    // US DST 2026 fall back: 2026-11-01 (clocks 02:00→01:00).
    const range = { from: d('2026-10-31'), to: d('2026-11-02') };
    expect(isoDays(expand({ preset: 'daily' }, range))).toEqual([
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });

  it('yearly_on_date Feb 29 SKIPS non-leap years (per engine policy comment)', () => {
    // 2026, 2027, 2029, 2030 are non-leap; 2028 is.
    const range = { from: d('2026-01-01'), to: d('2030-12-31') };
    expect(
      isoDays(expand({ preset: 'yearly_on_date', month: 2, day: 29 }, range)),
    ).toEqual(['2028-02-29']);
  });

  it('biweekly cadence holds across a year boundary', () => {
    // Anchor: Mon 2026-12-21. Next: Jan 4, then Jan 18, then Feb 1, 2027.
    const range = { from: d('2026-12-15'), to: d('2027-02-15') };
    expect(
      isoDays(
        expand(
          { preset: 'biweekly', days: [1], anchor: '2026-12-21' },
          range,
        ),
      ),
    ).toEqual([
      '2026-12-21',
      '2027-01-04',
      '2027-01-18',
      '2027-02-01',
      '2027-02-15',
    ]);
  });

  it('returns empty when range is inverted', () => {
    expect(
      expand(
        { preset: 'daily' },
        { from: d('2026-05-15'), to: d('2026-05-10') },
      ),
    ).toEqual([]);
  });

  it('every_n_weeks returns empty when n is zero or negative', () => {
    expect(
      expand(
        {
          preset: 'every_n_weeks',
          n: 0,
          days: [1],
          anchor: '2026-05-11',
        },
        { from: d('2026-05-11'), to: d('2026-05-31') },
      ),
    ).toEqual([]);
  });

  it('every_n_days excludes dates before the anchor', () => {
    expect(
      isoDays(
        expand(
          { preset: 'every_n_days', n: 2, anchor: '2026-05-15' },
          { from: d('2026-05-10'), to: d('2026-05-20') },
        ),
      ),
    ).toEqual(['2026-05-15', '2026-05-17', '2026-05-19']);
  });
});
