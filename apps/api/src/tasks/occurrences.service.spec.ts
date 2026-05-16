import {
  bucketFor,
  combineDateAndDueTime,
  isAutoComplete,
  reanchorOccurrence,
  toView,
} from './occurrences.service';
import {
  audibleWarningContributes,
  cleanStreakAdvances,
  dailyRoutineStreakAdvances,
  filterStreakEligible,
  OccurrenceWithTask,
} from './streak-stub';
import { TaskEntity } from './task.entity';
import { OccurrenceEntity } from './occurrence.entity';

function makeOccurrence(overrides: {
  scheduledAt: Date;
  kind?: 'reminder' | 'recurring';
  status?: OccurrenceEntity['status'];
}): OccurrenceWithTask {
  const task = {
    id: 't1',
    kind: overrides.kind ?? 'reminder',
    name: 'Eat breakfast',
    icon: null,
    dueTime: '08:00:00',
    recurrence: null,
    points: 0,
    active: true,
    createdAt: new Date('2026-05-14T00:00:00Z'),
    assignees: [],
    occurrences: [],
  } as unknown as TaskEntity;
  return {
    id: 'o1',
    task,
    taskId: 't1',
    user: undefined as never,
    userId: 'u1',
    scheduledAt: overrides.scheduledAt,
    localDay: overrides.scheduledAt.toISOString().slice(0, 10),
    windowEnd: null,
    status: overrides.status ?? 'active',
    pendingSince: null,
    deferredFromOccurrenceId: null,
    updatedAt: new Date(),
  } as OccurrenceWithTask;
}

describe('isAutoComplete — auto-complete time threshold', () => {
  const scheduled = new Date('2026-05-14T08:00:00');

  it('is false one millisecond before the scheduled instant', () => {
    expect(isAutoComplete(scheduled, new Date(scheduled.getTime() - 1))).toBe(
      false,
    );
  });

  it('is true at the exact scheduled instant (inclusive boundary)', () => {
    expect(isAutoComplete(scheduled, new Date(scheduled.getTime()))).toBe(true);
  });

  it('is true any time after the scheduled instant', () => {
    expect(isAutoComplete(scheduled, new Date(scheduled.getTime() + 1))).toBe(
      true,
    );
    expect(
      isAutoComplete(scheduled, new Date(scheduled.getTime() + 12 * 3600_000)),
    ).toBe(true);
  });
});

describe('toView — "past reminders always render as ✓"', () => {
  // The rule applies even when the Trackee is presence-suppressed; the
  // view layer does no presence check here because the auto-complete rule
  // is unconditional on scheduled_at vs. now.
  it('reports auto_complete=true for any past reminder regardless of status', () => {
    const scheduled = new Date('2026-05-14T08:00:00');
    const now = new Date('2026-05-14T21:00:00');
    for (const status of ['active', 'excused', 'deferred'] as const) {
      const occ = makeOccurrence({ scheduledAt: scheduled, status });
      const view = toView(occ, now, 'UTC');
      expect(view.auto_complete).toBe(true);
      expect(view.status).toBe('auto_complete');
    }
  });

  it('reports auto_complete=false for a future reminder', () => {
    const scheduled = new Date('2026-05-14T21:00:00');
    const now = new Date('2026-05-14T08:00:00');
    const occ = makeOccurrence({ scheduledAt: scheduled });
    const view = toView(occ, now, 'UTC');
    expect(view.auto_complete).toBe(false);
    expect(view.status).toBe('active');
  });
});

describe('bucketFor', () => {
  it.each([
    ['07:30', 'morning'],
    ['11:59', 'morning'],
    ['12:00', 'after_school'],
    ['16:30', 'after_school'],
    ['17:00', 'evening'],
    ['21:00', 'evening'],
  ])('buckets %s into %s', (hhmm, expected) => {
    const d = combineDateAndDueTime(new Date('2026-05-14T12:00:00Z'), hhmm, 'UTC');
    expect(bucketFor(d, 'UTC')).toBe(expected);
  });

  // Regression: the routine board grouped reminders into the wrong section
  // because the hour was read in the API process's own zone rather than the
  // household's. With a tz the bucket must follow the household wall-clock.
  it('reads the hour in the household tz, not the process tz', () => {
    // 11:45 UTC — a morning due_time in a UTC household. Buckets as morning
    // regardless of where the process runs.
    const instant = new Date('2026-05-30T11:45:00Z');
    expect(bucketFor(instant, 'UTC')).toBe('morning');
    // 19:00 UTC is the evening; only in a behind-UTC zone (where it reads as
    // an afternoon) would it land in after_school.
    const evening = new Date('2026-05-30T19:00:00Z');
    expect(bucketFor(evening, 'UTC')).toBe('evening');
    expect(bucketFor(evening, 'America/New_York')).toBe('after_school'); // 15:00 EDT
  });
});

describe('toView — display_time / bucket pinned to household tz', () => {
  // Regression for the tablet showing times shifted by the browser/process tz
  // (e.g. a 11:45 reminder rendering as 04:45 and falling under Morning while
  // an evening reminder slid into After school).
  it('renders display_time and bucket from the household tz', () => {
    const now = new Date('2026-05-30T00:00:00Z');
    const morning = makeOccurrence({
      scheduledAt: new Date('2026-05-30T11:45:00Z'),
    });
    const morningView = toView(morning, now, 'UTC');
    expect(morningView.display_time).toBe('11:45 AM');
    expect(morningView.bucket).toBe('morning');

    const evening = makeOccurrence({
      scheduledAt: new Date('2026-05-30T19:00:00Z'),
    });
    const eveningView = toView(evening, now, 'UTC');
    expect(eveningView.display_time).toBe('7:00 PM');
    expect(eveningView.bucket).toBe('evening');
  });

  it('the same instant reads differently under a different household tz', () => {
    const now = new Date('2026-05-30T00:00:00Z');
    const occ = makeOccurrence({
      scheduledAt: new Date('2026-05-30T11:45:00Z'),
    });
    // 11:45 UTC = 4:45 AM in America/Los_Angeles (PDT) — still morning, but the
    // displayed wall-clock follows the configured zone.
    const view = toView(occ, now, 'America/Los_Angeles');
    expect(view.display_time).toBe('4:45 AM');
    expect(view.bucket).toBe('morning');
  });
});

describe('combineDateAndDueTime — tz-aware', () => {
  it('interprets due_time as wall-clock in the given IANA tz (PDT)', () => {
    // 2026-05-14 is in PDT (UTC-7). 11:30 PDT = 18:30 UTC.
    const result = combineDateAndDueTime(
      new Date('2026-05-14T12:00:00Z'),
      '11:30',
      'America/Los_Angeles',
    );
    expect(result.toISOString()).toBe('2026-05-14T18:30:00.000Z');
  });

  it('uses the calendar day as observed in the household tz', () => {
    // At 06:00 UTC on 2026-05-14, household clock in PDT is still 23:00 on
    // 2026-05-13. A 23:00 due_time should resolve to that prior day.
    const result = combineDateAndDueTime(
      new Date('2026-05-14T06:00:00Z'),
      '23:00',
      'America/Los_Angeles',
    );
    expect(result.toISOString()).toBe('2026-05-14T06:00:00.000Z');
  });

  it('resolves the wall-clock instant independent of the process zone (UTC household)', () => {
    const result = combineDateAndDueTime(
      new Date('2026-05-14T12:00:00Z'),
      '11:30',
      'UTC',
    );
    expect(result.toISOString()).toBe('2026-05-14T11:30:00.000Z');
  });
});

describe('reanchorOccurrence — preserve wall-clock when the household tz changes', () => {
  // Regression: a reminder due 20:00 generated while the household was UTC got
  // scheduled_at = 20:00:00Z. After the admin switched the household zone to
  // America/Los_Angeles, the tablet showed display_time 13:00 (20:00Z in PDT)
  // instead of the 20:00 the admin typed — because the stale occurrence was
  // never re-anchored. Re-anchoring must keep the wall-clock meaning.
  function makeStaleReminder(): OccurrenceEntity {
    const occ = makeOccurrence({
      scheduledAt: new Date('2026-05-30T20:00:00Z'), // 20:00 as a UTC instant
    }) as unknown as OccurrenceEntity;
    occ.task.dueTime = '20:00:00';
    occ.localDay = '2026-05-30';
    return occ;
  }

  it('moves scheduled_at so a 20:00 due_time stays 20:00 wall-clock in the new zone', () => {
    const occ = makeStaleReminder();
    const changed = reanchorOccurrence(occ, occ.task, 'America/Los_Angeles');
    expect(changed).toBe(true);
    // 20:00 PDT on 2026-05-30 = 03:00 UTC the next calendar day.
    expect(occ.scheduledAt.toISOString()).toBe('2026-05-31T03:00:00.000Z');
    // The civil day the occurrence belongs to is preserved.
    expect(occ.localDay).toBe('2026-05-30');
    // And the tablet now renders the wall-clock the admin typed.
    const view = toView(
      occ as Parameters<typeof toView>[0],
      new Date('2026-05-30T17:00:00Z'),
      'America/Los_Angeles',
    );
    expect(view.display_time).toBe('8:00 PM');
    expect(view.bucket).toBe('evening');
  });

  it('is a no-op when the occurrence is already anchored for the zone', () => {
    const occ = makeStaleReminder();
    reanchorOccurrence(occ, occ.task, 'America/Los_Angeles');
    // Re-running with the same zone changes nothing.
    expect(reanchorOccurrence(occ, occ.task, 'America/Los_Angeles')).toBe(false);
  });

  it('skips one-shot windowed occurrences (absolute admin-picked instants)', () => {
    const occ = makeOccurrence({
      scheduledAt: new Date('2026-05-30T20:00:00Z'),
    }) as unknown as OccurrenceEntity;
    occ.task.kind = 'windowed' as TaskEntity['kind'];
    occ.task.recurrence = null;
    occ.windowEnd = new Date('2026-05-30T22:00:00Z');
    const before = occ.scheduledAt.toISOString();
    expect(reanchorOccurrence(occ, occ.task, 'America/Los_Angeles')).toBe(false);
    expect(occ.scheduledAt.toISOString()).toBe(before);
  });
});

describe('reminder exclusion — streak + audible-warning stubs', () => {
  const morning = new Date('2026-05-14T08:00:00');

  it('filterStreakEligible drops reminder occurrences', () => {
    const reminder = makeOccurrence({ scheduledAt: morning, kind: 'reminder' });
    const recurring = makeOccurrence({
      scheduledAt: morning,
      kind: 'recurring',
      status: 'complete',
    });
    const eligible = filterStreakEligible([reminder, recurring]);
    expect(eligible).toHaveLength(1);
    expect(eligible[0].task.kind).toBe('recurring');
  });

  it('cleanStreakAdvances always returns false for a reminder occurrence', () => {
    const completedReminder = makeOccurrence({
      scheduledAt: morning,
      kind: 'reminder',
      status: 'complete',
    });
    expect(cleanStreakAdvances(completedReminder)).toBe(false);
  });

  it('audibleWarningContributes always returns false for a reminder', () => {
    const activeReminder = makeOccurrence({
      scheduledAt: morning,
      kind: 'reminder',
      status: 'active',
    });
    expect(audibleWarningContributes(activeReminder)).toBe(false);
  });

  it('dailyRoutineStreakAdvances treats a reminder-only day as a non-event', () => {
    // Days with zero scheduled non-reminder tasks are non-events (the
    // streak counter neither breaks nor advances). The stub models the
    // "doesn't advance" half — break vs. preserve is covered by the streak
    // engine's own tests.
    const onlyReminders = [
      makeOccurrence({ scheduledAt: morning, kind: 'reminder', status: 'complete' }),
      makeOccurrence({ scheduledAt: morning, kind: 'reminder', status: 'active' }),
    ];
    expect(dailyRoutineStreakAdvances(onlyReminders)).toBe(false);
  });

  it('dailyRoutineStreakAdvances advances when all non-reminder tasks are complete', () => {
    const day = [
      makeOccurrence({ scheduledAt: morning, kind: 'reminder', status: 'active' }),
      makeOccurrence({
        scheduledAt: morning,
        kind: 'recurring',
        status: 'complete',
      }),
    ];
    expect(dailyRoutineStreakAdvances(day)).toBe(true);
  });
});
