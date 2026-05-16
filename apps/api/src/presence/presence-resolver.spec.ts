import {
  GridCells,
  isHome as isHomeTz,
  PresenceScheduleLike,
} from './presence-resolver';
import type { OneOffWindow } from './presence.entity';

// These cases were written against the resolver's original UTC-component
// behavior; `tz: 'UTC'` reproduces it exactly. Non-UTC household coverage
// lives in the dedicated household-tz describe block below.
const isHome = (s: PresenceScheduleLike, instant: Date, tz = 'UTC'): boolean =>
  isHomeTz(s, instant, tz);

describe('presence resolver — isHome', () => {
  const fullTime: PresenceScheduleLike = { recurringRuleKind: 'full_time' };
  const none: PresenceScheduleLike = { recurringRuleKind: 'none' };

  it('full_time: returns true at every probe instant', () => {
    const probes = [
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-05-16T08:00:00'),
      new Date('2026-07-04T23:59:59'),
      new Date('2026-12-31T12:00:00Z'),
    ];
    for (const p of probes) expect(isHome(fullTime, p)).toBe(true);
  });

  it('none: returns true at every probe instant', () => {
    const probes = [
      new Date('2026-03-08T01:30:00'),
      new Date('2026-11-01T01:30:00'),
      new Date('2026-06-15T17:00:00'),
    ];
    for (const p of probes) expect(isHome(none, p)).toBe(true);
  });

  it('full_time: invariant across DST spring-forward and fall-back', () => {
    const probes = [
      new Date('2026-03-08T01:59:59'),
      new Date('2026-03-08T03:00:01'),
      new Date('2026-11-01T01:30:00'),
      new Date('2026-11-01T02:30:00'),
    ];
    for (const p of probes) expect(isHome(fullTime, p)).toBe(true);
  });

  it('iterates a full year of midnights for full_time/none without flipping', () => {
    const start = new Date('2026-01-01T00:00:00Z').getTime();
    const day = 24 * 60 * 60_000;
    for (let i = 0; i < 365; i++) {
      const instant = new Date(start + i * day);
      expect(isHome(fullTime, instant)).toBe(true);
      expect(isHome(none, instant)).toBe(true);
    }
  });

  describe('n_week_grid — 2-week alternation', () => {
    // Cells indexed [week][weekday], weekday 0=Mon..6=Sun.
    //
    // Week A: Tue–Sat home, with Tue arrival 15:30 and Fri marker 15:30.
    //         Mon = away (continuous from Week B Sun-away), Sun = away.
    // Week B: Fri,Sat home; Sun-as-away at 09:00. Mon–Thu = away.
    //
    // Net transitions across the cycle:
    //   Week A · Tue 15:30 → home   (explicit)
    //   Week A · Fri 15:30 → home   (explicit on a same-kind cell; idempotent)
    //   Week A · Sun 00:00 → away   (implicit, kind flip)
    //   Week B · Fri 00:00 → home   (implicit, kind flip)
    //   Week B · Sun 09:00 → away   (explicit)
    const cells: GridCells = [
      [
        { kind: 'away' },
        { kind: 'home', handoff_time: '15:30' },
        { kind: 'home' },
        { kind: 'home' },
        { kind: 'home', handoff_time: '15:30' },
        { kind: 'home' },
        { kind: 'away' },
      ],
      [
        { kind: 'away' },
        { kind: 'away' },
        { kind: 'away' },
        { kind: 'away' },
        { kind: 'home' },
        { kind: 'home' },
        { kind: 'away', handoff_time: '09:00' },
      ],
    ];

    // Epoch chosen on a Monday so Week A maps to that ISO week.
    const schedule: PresenceScheduleLike = {
      recurringRuleKind: 'n_week_grid',
      gridNWeeks: 2,
      gridCells: cells,
      epochDate: '2026-05-04', // Monday → ISO week starts here, Week A.
    };

    it('Week A · Tuesday: away before hand-off, home from 15:30', () => {
      expect(isHome(schedule, new Date('2026-05-05T14:59:59Z'))).toBe(false);
      expect(isHome(schedule, new Date('2026-05-05T15:30:00Z'))).toBe(true);
      expect(isHome(schedule, new Date('2026-05-05T20:00:00Z'))).toBe(true);
    });

    it('Week A · Wed–Sat: continuous home, including across Fri 15:30 marker', () => {
      const homes = [
        new Date('2026-05-06T09:00:00Z'),
        new Date('2026-05-07T22:00:00Z'),
        new Date('2026-05-08T15:29:59Z'),
        new Date('2026-05-08T15:30:00Z'),
        new Date('2026-05-09T03:00:00Z'),
      ];
      for (const p of homes) expect(isHome(schedule, p)).toBe(true);
    });

    it('Week A · Sunday: away at every time-of-day (implicit 00:00 flip)', () => {
      const aways = [
        new Date('2026-05-10T00:00:00Z'),
        new Date('2026-05-10T12:00:00Z'),
        new Date('2026-05-10T23:59:59Z'),
      ];
      for (const p of aways) expect(isHome(schedule, p)).toBe(false);
    });

    it('Week B · Mon–Thu: continuous away', () => {
      const aways = [
        new Date('2026-05-11T08:00:00Z'),
        new Date('2026-05-12T20:00:00Z'),
        new Date('2026-05-13T03:30:00Z'),
        new Date('2026-05-14T22:00:00Z'),
      ];
      for (const p of aways) expect(isHome(schedule, p)).toBe(false);
    });

    it('Week B · Fri 00:00: implicit kind-flip lands at midnight', () => {
      expect(isHome(schedule, new Date('2026-05-14T23:59:59Z'))).toBe(false);
      expect(isHome(schedule, new Date('2026-05-15T00:00:00Z'))).toBe(true);
      expect(isHome(schedule, new Date('2026-05-16T09:00:00Z'))).toBe(true);
    });

    it('Week B · Sunday: home before 09:00, away from 09:00', () => {
      expect(isHome(schedule, new Date('2026-05-17T08:59:59Z'))).toBe(true);
      expect(isHome(schedule, new Date('2026-05-17T09:00:00Z'))).toBe(false);
      expect(isHome(schedule, new Date('2026-05-17T20:00:00Z'))).toBe(false);
    });

    it('alternation continues across a month boundary', () => {
      // 2026-05-31 is the Sunday wrapping Week B (cycle 2). 2026-06-01 is the
      // Monday starting Week A (cycle 3). Cells should align mod-N regardless
      // of the calendar month.
      expect(isHome(schedule, new Date('2026-05-31T10:00:00Z'))).toBe(false);
      // Mon of next Week A = continuous away (no transition until Tue 15:30).
      expect(isHome(schedule, new Date('2026-06-01T22:00:00Z'))).toBe(false);
      // Tue Week A after 15:30 = home.
      expect(isHome(schedule, new Date('2026-06-02T16:00:00Z'))).toBe(true);
    });

    it('alternation continues across a year boundary', () => {
      // Epoch 2026-05-04 + 35 weeks (odd) lands on a Week B Monday in 2027.
      // 2026-05-04 + 35*7 = 2027-01-04 (Mon), Week B.
      expect(isHome(schedule, new Date('2027-01-04T08:00:00Z'))).toBe(false);
      // Friday of that Week B = home (continuous).
      expect(isHome(schedule, new Date('2027-01-08T12:00:00Z'))).toBe(true);
      // The following Tuesday is Week A's Tuesday — same Tue 15:30 rule.
      expect(isHome(schedule, new Date('2027-01-12T14:00:00Z'))).toBe(false);
      expect(isHome(schedule, new Date('2027-01-12T15:30:00Z'))).toBe(true);
    });

    it('epoch_date not on a Monday: snaps to that week’s ISO Monday', () => {
      // Wed 2026-05-06 → snaps to Mon 2026-05-04 = same as the canonical epoch.
      const snapped: PresenceScheduleLike = {
        ...schedule,
        epochDate: '2026-05-06',
      };
      expect(isHome(snapped, new Date('2026-05-05T15:30:00Z'))).toBe(true);
      expect(isHome(snapped, new Date('2026-05-17T09:00:00Z'))).toBe(false);
    });

    it('hand-off transition is precisely at-or-after the configured minute', () => {
      // The contract is "at or after" — 15:30:00 is home, 15:29:59 is not.
      expect(isHome(schedule, new Date('2026-05-05T15:29:59Z'))).toBe(false);
      expect(isHome(schedule, new Date('2026-05-05T15:30:00Z'))).toBe(true);
    });

    it('defensive fallback: malformed grid resolves to home', () => {
      const bad: PresenceScheduleLike = {
        recurringRuleKind: 'n_week_grid',
        gridNWeeks: 2,
        gridCells: null,
        epochDate: '2026-05-04',
      };
      expect(isHome(bad, new Date('2026-05-10T00:00:00Z'))).toBe(true);
    });

    it('uniform grid with no transitions: reads the current cell directly', () => {
      const allAway: GridCells = [
        [
          { kind: 'away' }, { kind: 'away' }, { kind: 'away' },
          { kind: 'away' }, { kind: 'away' }, { kind: 'away' }, { kind: 'away' },
        ],
      ];
      const uniform: PresenceScheduleLike = {
        recurringRuleKind: 'n_week_grid',
        gridNWeeks: 1,
        gridCells: allAway,
        epochDate: '2026-05-04',
      };
      expect(isHome(uniform, new Date('2026-05-10T12:00:00Z'))).toBe(false);
    });
  });

  describe('one-off vacation windows', () => {
    const vacationWindow: OneOffWindow = {
      start: '2026-06-01',
      end: '2026-06-07',
      label: 'Summer camp',
    };

    it('full_time schedule: vacation window overrides to away', () => {
      const s: PresenceScheduleLike = {
        recurringRuleKind: 'full_time',
        oneOffWindows: [vacationWindow],
      };
      expect(isHome(s, new Date('2026-06-01T00:00:00Z'))).toBe(false);
      expect(isHome(s, new Date('2026-06-04T12:00:00Z'))).toBe(false);
      expect(isHome(s, new Date('2026-06-07T23:59:59Z'))).toBe(false);
    });

    it('full_time schedule: instants outside the window are unaffected', () => {
      const s: PresenceScheduleLike = {
        recurringRuleKind: 'full_time',
        oneOffWindows: [vacationWindow],
      };
      expect(isHome(s, new Date('2026-05-31T23:59:59Z'))).toBe(true);
      expect(isHome(s, new Date('2026-06-08T00:00:00Z'))).toBe(true);
    });

    it('n_week_grid: vacation window overrides a home cell to away', () => {
      const allHome: GridCells = [
        Array.from({ length: 7 }, () => ({ kind: 'home' as const })),
      ];
      const s: PresenceScheduleLike = {
        recurringRuleKind: 'n_week_grid',
        gridNWeeks: 1,
        gridCells: allHome,
        epochDate: '2026-05-04',
        oneOffWindows: [vacationWindow],
      };
      // Inside the window — grid says home but vacation overrides to away.
      expect(isHome(s, new Date('2026-06-03T10:00:00Z'))).toBe(false);
      // Outside the window — grid home cell is respected.
      expect(isHome(s, new Date('2026-05-20T10:00:00Z'))).toBe(true);
    });

    it('no oneOffWindows field: no override applied', () => {
      const s: PresenceScheduleLike = { recurringRuleKind: 'full_time' };
      expect(isHome(s, new Date('2026-06-04T12:00:00Z'))).toBe(true);
    });

    it('empty oneOffWindows array: no override applied', () => {
      const s: PresenceScheduleLike = {
        recurringRuleKind: 'full_time',
        oneOffWindows: [],
      };
      expect(isHome(s, new Date('2026-06-04T12:00:00Z'))).toBe(true);
    });

    it('multiple vacation windows: any matching window triggers away', () => {
      const s: PresenceScheduleLike = {
        recurringRuleKind: 'full_time',
        oneOffWindows: [
          { start: '2026-06-01', end: '2026-06-07', label: 'Camp' },
          { start: '2026-07-04', end: '2026-07-04', label: 'Holiday' },
        ],
      };
      expect(isHome(s, new Date('2026-06-05T12:00:00Z'))).toBe(false);
      expect(isHome(s, new Date('2026-07-04T10:00:00Z'))).toBe(false);
      expect(isHome(s, new Date('2026-06-20T12:00:00Z'))).toBe(true);
    });

    it('vacation window boundary: inclusive on both start and end date', () => {
      const s: PresenceScheduleLike = {
        recurringRuleKind: 'full_time',
        oneOffWindows: [{ start: '2026-06-01', end: '2026-06-01', label: 'Single day' }],
      };
      expect(isHome(s, new Date('2026-06-01T00:00:00Z'))).toBe(false);
      expect(isHome(s, new Date('2026-06-01T23:59:59Z'))).toBe(false);
      expect(isHome(s, new Date('2026-05-31T23:59:59Z'))).toBe(true);
      expect(isHome(s, new Date('2026-06-02T00:00:00Z'))).toBe(true);
    });
  });

  describe('hand-off + vacation evaluated in the household tz (not UTC)', () => {
    // A single home cell (Tuesday) with a 15:30 hand-off. The same instant must
    // resolve differently depending on the household zone, proving the
    // hand-off minute is read in that zone rather than in UTC.
    const cells: GridCells = [
      [
        { kind: 'away' },
        { kind: 'home', handoff_time: '15:30' },
        { kind: 'away' },
        { kind: 'away' },
        { kind: 'away' },
        { kind: 'away' },
        { kind: 'away' },
      ],
    ];
    const schedule: PresenceScheduleLike = {
      recurringRuleKind: 'n_week_grid',
      gridNWeeks: 1,
      gridCells: cells,
      epochDate: '2026-05-04', // Monday
    };

    it('a 15:30 hand-off flips at 15:30 household-local, not 15:30 UTC', () => {
      // 2026-05-05 is the Tuesday. 22:00Z is 15:00 PDT (before hand-off) but
      // already past 15:30 in UTC.
      const at2200z = new Date('2026-05-05T22:00:00Z');
      expect(isHomeTz(schedule, at2200z, 'UTC')).toBe(true); // 22:00 UTC ≥ 15:30
      expect(isHomeTz(schedule, at2200z, 'America/Los_Angeles')).toBe(false); // 15:00 PDT < 15:30
      // 22:30Z == 15:30 PDT exactly → home in LA.
      expect(
        isHomeTz(schedule, new Date('2026-05-05T22:30:00Z'), 'America/Los_Angeles'),
      ).toBe(true);
    });

    it('a vacation window date is matched against the household-local day', () => {
      const s: PresenceScheduleLike = {
        recurringRuleKind: 'full_time',
        oneOffWindows: [{ start: '2026-06-01', end: '2026-06-01', label: 'Day' }],
      };
      // 2026-06-02T05:00Z is still 2026-06-01 22:00 in PDT → inside the window
      // for an LA household, but 2026-06-02 (outside) for a UTC household.
      const instant = new Date('2026-06-02T05:00:00Z');
      expect(isHomeTz(s, instant, 'UTC')).toBe(true); // 06-02, outside
      expect(isHomeTz(s, instant, 'America/Los_Angeles')).toBe(false); // 06-01, inside
    });
  });
});
