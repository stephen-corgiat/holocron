import { describe, it, expect } from 'vitest';
import {
  dottedDateInTz,
  dowInTz,
  dowLabelInTz,
  hourInTz,
  isoDateInTz,
  utcInstantInTz,
  wallClockInTz,
} from './datetime';

// These assertions hold regardless of the machine's own TZ — the whole point
// of the helpers is that the projection follows the passed zone, not the host.
describe('wallClockInTz', () => {
  it('renders 12-hour am/pm time in the given zone', () => {
    const iso = '2026-05-30T11:45:00Z';
    expect(wallClockInTz(iso, 'UTC')).toBe('11:45 AM');
    expect(wallClockInTz(iso, 'America/Los_Angeles')).toBe('4:45 AM'); // PDT
    expect(wallClockInTz(iso, 'America/New_York')).toBe('7:45 AM'); // EDT
  });

  it('renders midnight and noon with 12 and the right marker', () => {
    expect(wallClockInTz('2026-05-30T00:00:00Z', 'UTC')).toBe('12:00 AM');
    expect(wallClockInTz('2026-05-30T12:00:00Z', 'UTC')).toBe('12:00 PM');
  });

  it('handles the local-midnight boundary', () => {
    // 02:00 UTC == 7:00 PM prev-day PDT.
    expect(wallClockInTz('2026-05-30T02:00:00Z', 'America/Los_Angeles')).toBe(
      '7:00 PM',
    );
  });
});

describe('hourInTz / dowInTz', () => {
  it('reads hour and weekday in the given zone', () => {
    const iso = '2026-05-31T03:00:00Z'; // Sun 03:00 UTC, still Sat 20:00 PDT
    expect(hourInTz(iso, 'UTC')).toBe(3);
    expect(dowInTz(iso, 'UTC')).toBe(0); // Sunday
    expect(hourInTz(iso, 'America/Los_Angeles')).toBe(20);
    expect(dowInTz(iso, 'America/Los_Angeles')).toBe(6); // Saturday
  });
});

describe('isoDateInTz / dottedDateInTz / dowLabelInTz', () => {
  it('formats the civil date in the given zone', () => {
    const iso = '2026-05-30T02:00:00Z';
    expect(isoDateInTz(iso, 'UTC')).toBe('2026-05-30');
    expect(isoDateInTz(iso, 'America/Los_Angeles')).toBe('2026-05-29');
    expect(dottedDateInTz(iso, 'America/Los_Angeles')).toBe('2026·05·29');
    expect(dowLabelInTz(iso, 'America/Los_Angeles')).toBe('FRI'); // 2026-05-29
  });
});

describe('utcInstantInTz', () => {
  it('interprets a wall-clock string as the UTC instant it denotes in the zone', () => {
    // 11:30 PDT == 18:30 UTC.
    expect(utcInstantInTz('2026-05-30T11:30', 'America/Los_Angeles').toISOString()).toBe(
      '2026-05-30T18:30:00.000Z',
    );
    // 11:30 UTC stays 11:30 UTC.
    expect(utcInstantInTz('2026-05-30T11:30', 'UTC').toISOString()).toBe(
      '2026-05-30T11:30:00.000Z',
    );
  });

  it('round-trips with wallClockInTz', () => {
    const tz = 'America/New_York';
    const instant = utcInstantInTz('2026-07-04T09:15', tz);
    expect(wallClockInTz(instant, tz)).toBe('9:15 AM');
    expect(isoDateInTz(instant, tz)).toBe('2026-07-04');
  });

  it('is DST-correct across the spring-forward day', () => {
    // 03:30 local on 2026-03-08 (after the 02:00->03:00 jump) is 10:30 UTC (PDT).
    expect(utcInstantInTz('2026-03-08T03:30', 'America/Los_Angeles').toISOString()).toBe(
      '2026-03-08T10:30:00.000Z',
    );
  });
});
