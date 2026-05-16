import {
  addDaysInTz,
  dayOfWeekInTz,
  endOfDayInTz,
  hourInTz,
  isoDateInTz,
  minutesOfDayInTz,
  startOfDayInTz,
  wallClockInTz,
  ymdInTz,
} from './tz';

describe('wallClockInTz', () => {
  it('renders the wall-clock 12-hour time as observed in the given zone', () => {
    const instant = new Date('2026-05-30T11:45:00Z');
    expect(wallClockInTz(instant, 'UTC')).toBe('11:45 AM');
    // PDT (UTC-7) in late May.
    expect(wallClockInTz(instant, 'America/Los_Angeles')).toBe('4:45 AM');
    // EDT (UTC-4).
    expect(wallClockInTz(instant, 'America/New_York')).toBe('7:45 AM');
  });

  it('zero-pads minutes but not the 12-hour hour', () => {
    const instant = new Date('2026-05-30T08:05:00Z');
    expect(wallClockInTz(instant, 'UTC')).toBe('8:05 AM');
  });

  it('renders midnight and noon with 12 and the right marker', () => {
    expect(wallClockInTz(new Date('2026-05-30T00:00:00Z'), 'UTC')).toBe(
      '12:00 AM',
    );
    expect(wallClockInTz(new Date('2026-05-30T12:00:00Z'), 'UTC')).toBe(
      '12:00 PM',
    );
  });

  it('crosses the date boundary correctly', () => {
    // 02:00 UTC is still the previous evening (7:00 PM) in PDT.
    const instant = new Date('2026-05-30T02:00:00Z');
    expect(wallClockInTz(instant, 'America/Los_Angeles')).toBe('7:00 PM');
  });
});

describe('hourInTz', () => {
  it('returns the 24h hour as observed in the given zone', () => {
    const instant = new Date('2026-05-30T19:00:00Z');
    expect(hourInTz(instant, 'UTC')).toBe(19);
    expect(hourInTz(instant, 'America/New_York')).toBe(15); // EDT
    expect(hourInTz(instant, 'America/Los_Angeles')).toBe(12); // PDT
  });

  it('reads midnight as hour 0', () => {
    expect(hourInTz(new Date('2026-05-30T00:00:00Z'), 'UTC')).toBe(0);
  });
});

describe('isoDateInTz', () => {
  it('returns the civil date observed in the zone', () => {
    const instant = new Date('2026-05-30T02:00:00Z');
    expect(isoDateInTz(instant, 'UTC')).toBe('2026-05-30');
    // 02:00 UTC is still 2026-05-29 in PDT.
    expect(isoDateInTz(instant, 'America/Los_Angeles')).toBe('2026-05-29');
  });
});

describe('dayOfWeekInTz', () => {
  it('returns 0=Sun..6=Sat for the civil day in the zone', () => {
    // 2026-05-30 is a Saturday.
    const sat = new Date('2026-05-30T12:00:00Z');
    expect(dayOfWeekInTz(sat, 'UTC')).toBe(6);
    // 2026-05-31T03:00Z is Sunday in UTC but still Saturday in PDT.
    const edge = new Date('2026-05-31T03:00:00Z');
    expect(dayOfWeekInTz(edge, 'UTC')).toBe(0);
    expect(dayOfWeekInTz(edge, 'America/Los_Angeles')).toBe(6);
  });
});

describe('minutesOfDayInTz', () => {
  it('returns minutes since local midnight', () => {
    const instant = new Date('2026-05-30T19:45:00Z');
    expect(minutesOfDayInTz(instant, 'UTC')).toBe(19 * 60 + 45);
    expect(minutesOfDayInTz(instant, 'America/Los_Angeles')).toBe(12 * 60 + 45); // PDT
  });

  it('reads local midnight as 0', () => {
    // 07:00 UTC == 00:00 PDT.
    expect(
      minutesOfDayInTz(new Date('2026-05-30T07:00:00Z'), 'America/Los_Angeles'),
    ).toBe(0);
  });
});

describe('startOfDayInTz / endOfDayInTz', () => {
  it('brackets the civil day as UTC instants', () => {
    const ymd = ymdInTz(new Date('2026-05-30T19:00:00Z'), 'America/Los_Angeles');
    // PDT midnight 2026-05-30 == 07:00 UTC.
    expect(startOfDayInTz(ymd, 'America/Los_Angeles').toISOString()).toBe(
      '2026-05-30T07:00:00.000Z',
    );
    expect(endOfDayInTz(ymd, 'America/Los_Angeles').toISOString()).toBe(
      '2026-05-31T06:59:59.999Z',
    );
  });
});

describe('addDaysInTz', () => {
  it('advances by whole civil days anchored to local midnight', () => {
    const start = startOfDayInTz(
      { year: 2026, month: 4, day: 30 }, // 2026-05-30 (month 0-indexed)
      'America/Los_Angeles',
    );
    expect(addDaysInTz(start, 1, 'America/Los_Angeles').toISOString()).toBe(
      '2026-05-31T07:00:00.000Z',
    );
    expect(addDaysInTz(start, -1, 'America/Los_Angeles').toISOString()).toBe(
      '2026-05-29T07:00:00.000Z',
    );
  });

  it('stays anchored to local midnight across a spring-forward DST gap', () => {
    // PST->PDT spring-forward is 2026-03-08 02:00 local. Stepping from
    // 2026-03-07 local midnight (08:00 UTC) by one day must land on
    // 2026-03-08 local midnight (08:00 UTC) — and the *next* day is
    // 2026-03-09 local midnight (07:00 UTC, now PDT), 23h later, not 24h.
    const mar7 = startOfDayInTz(
      { year: 2026, month: 2, day: 7 },
      'America/Los_Angeles',
    );
    expect(mar7.toISOString()).toBe('2026-03-07T08:00:00.000Z');
    const mar8 = addDaysInTz(mar7, 1, 'America/Los_Angeles');
    expect(mar8.toISOString()).toBe('2026-03-08T08:00:00.000Z');
    const mar9 = addDaysInTz(mar8, 1, 'America/Los_Angeles');
    expect(mar9.toISOString()).toBe('2026-03-09T07:00:00.000Z');
  });

  it('stays anchored to local midnight across a fall-back DST overlap', () => {
    // PDT->PST fall-back is 2026-11-01 02:00 local. 2026-11-01 local midnight
    // is 07:00 UTC (still PDT); stepping one day lands on 2026-11-02 local
    // midnight at 08:00 UTC (now PST), 25h later.
    const nov1 = startOfDayInTz(
      { year: 2026, month: 10, day: 1 },
      'America/Los_Angeles',
    );
    expect(nov1.toISOString()).toBe('2026-11-01T07:00:00.000Z');
    const nov2 = addDaysInTz(nov1, 1, 'America/Los_Angeles');
    expect(nov2.toISOString()).toBe('2026-11-02T08:00:00.000Z');
  });
});
