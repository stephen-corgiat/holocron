import {
  affectedDateRange,
  reconcile as reconcileTz,
  ReconcileInput,
  ReconcileOccurrence,
} from './presence-reconcile';
import {
  isSuppressed as isSuppressedTz,
  PresenceScheduleLike,
} from './presence-resolver';

// Existing cases predate household-tz threading and assume UTC components;
// `tz: 'UTC'` reproduces the original behavior for them.
const reconcile = (input: Omit<ReconcileInput, 'tz'> & { tz?: string }) =>
  reconcileTz({ tz: 'UTC', ...input });
const isSuppressed = (
  s: PresenceScheduleLike,
  instant: Date,
  tz = 'UTC',
): boolean => isSuppressedTz(s, instant, tz);

const NOW = new Date('2026-05-16T12:00:00Z');

function makeOcc(
  partial: Partial<ReconcileOccurrence> & { id: string; scheduledAt: Date },
): ReconcileOccurrence {
  return {
    taskId: partial.taskId ?? 't-1',
    userId: partial.userId ?? 'u-1',
    status: partial.status ?? 'active',
    ...partial,
  };
}

describe('presence reconcile — pure', () => {
  describe('resolver/reconciler agreement', () => {
    it('classifies an occurrence the same way the resolver does for the same instant', () => {
      const sched: PresenceScheduleLike = {
        recurringRuleKind: 'full_time',
        oneOffWindows: [{ start: '2026-05-10', end: '2026-05-12', label: 'X' }],
      };
      const probes = [
        new Date('2026-05-09T20:00:00Z'),
        new Date('2026-05-10T08:00:00Z'),
        new Date('2026-05-11T20:00:00Z'),
        new Date('2026-05-13T08:00:00Z'),
      ];
      for (const p of probes) {
        const o = makeOcc({ id: 'o', scheduledAt: p });
        // reconcile uses isSuppressed internally; both must align.
        const fromResolver = isSuppressed(sched, p);
        const expectedEvent = reconcile({
          oldSchedule: { recurringRuleKind: 'full_time' },
          newSchedule: sched,
          occurrences: [{ ...o, status: 'missed' }],
          now: NOW,
        }).some((e) => e.kind === 'LedgerReversal');
        // If the resolver says "suppressed under new schedule" the reconciler
        // must emit a LedgerReversal for the previously-missed occurrence.
        expect(expectedEvent).toBe(fromResolver);
      }
    });
  });

  describe('adding a retroactive vacation', () => {
    const oldSched: PresenceScheduleLike = { recurringRuleKind: 'full_time' };
    const newSched: PresenceScheduleLike = {
      recurringRuleKind: 'full_time',
      oneOffWindows: [{ start: '2026-05-10', end: '2026-05-12', label: 'Camp' }],
    };

    it('emits LedgerReversal for a previously-missed occurrence inside the window', () => {
      const events = reconcile({
        oldSchedule: oldSched,
        newSchedule: newSched,
        now: NOW,
        occurrences: [
          makeOcc({
            id: 'o-missed',
            scheduledAt: new Date('2026-05-11T08:00:00Z'),
            status: 'missed',
          }),
        ],
      });
      expect(events.filter((e) => e.kind === 'LedgerReversal')).toHaveLength(1);
      expect(events.find((e) => e.kind === 'StreakRecompute')).toMatchObject({
        userId: 'u-1',
        days: ['2026-05-11'],
      });
    });

    it('does not reverse an excused/deferred/complete occurrence inside the window', () => {
      const events = reconcile({
        oldSchedule: oldSched,
        newSchedule: newSched,
        now: NOW,
        occurrences: [
          makeOcc({
            id: 'o-complete',
            scheduledAt: new Date('2026-05-11T08:00:00Z'),
            status: 'complete',
          }),
          makeOcc({
            id: 'o-excused',
            scheduledAt: new Date('2026-05-11T09:00:00Z'),
            status: 'excused',
          }),
        ],
      });
      expect(events.filter((e) => e.kind === 'LedgerReversal')).toHaveLength(0);
    });

    it('does nothing for occurrences outside the window (scope bound)', () => {
      const events = reconcile({
        oldSchedule: oldSched,
        newSchedule: newSched,
        now: NOW,
        occurrences: [
          makeOcc({
            id: 'o-before',
            scheduledAt: new Date('2026-05-09T08:00:00Z'),
            status: 'missed',
          }),
          makeOcc({
            id: 'o-after',
            scheduledAt: new Date('2026-05-13T08:00:00Z'),
            status: 'missed',
          }),
        ],
      });
      expect(events).toHaveLength(0);
    });
  });

  describe('removing a vacation', () => {
    const oldSched: PresenceScheduleLike = {
      recurringRuleKind: 'full_time',
      oneOffWindows: [{ start: '2026-05-10', end: '2026-05-12', label: 'Camp' }],
    };
    const newSched: PresenceScheduleLike = { recurringRuleKind: 'full_time' };

    it('fires a Miss for a past-deadline active occurrence newly no-longer-suppressed', () => {
      const events = reconcile({
        oldSchedule: oldSched,
        newSchedule: newSched,
        now: NOW,
        occurrences: [
          makeOcc({
            id: 'o-past',
            scheduledAt: new Date('2026-05-11T08:00:00Z'),
            status: 'active',
          }),
        ],
      });
      expect(events.filter((e) => e.kind === 'MissFire')).toEqual([
        {
          kind: 'MissFire',
          occurrenceId: 'o-past',
          userId: 'u-1',
          taskId: 't-1',
        },
      ]);
    });

    it('does NOT fire a Miss for a future-dated occurrence', () => {
      const events = reconcile({
        oldSchedule: oldSched,
        newSchedule: newSched,
        now: new Date('2026-05-10T00:00:00Z'),
        occurrences: [
          makeOcc({
            id: 'o-future',
            scheduledAt: new Date('2026-05-11T08:00:00Z'),
            status: 'active',
          }),
        ],
      });
      expect(events.filter((e) => e.kind === 'MissFire')).toHaveLength(0);
    });

    it('does NOT fire a Miss for an already-completed occurrence', () => {
      const events = reconcile({
        oldSchedule: oldSched,
        newSchedule: newSched,
        now: NOW,
        occurrences: [
          makeOcc({
            id: 'o-complete',
            scheduledAt: new Date('2026-05-11T08:00:00Z'),
            status: 'complete',
          }),
        ],
      });
      expect(events.filter((e) => e.kind === 'MissFire')).toHaveLength(0);
    });
  });

  describe('affectedDateRange', () => {
    it('returns the union of added/removed vacation windows', () => {
      const a: PresenceScheduleLike = { recurringRuleKind: 'full_time' };
      const b: PresenceScheduleLike = {
        recurringRuleKind: 'full_time',
        oneOffWindows: [
          { start: '2026-05-10', end: '2026-05-12', label: 'Camp' },
          { start: '2026-06-01', end: '2026-06-03', label: 'Trip' },
        ],
      };
      expect(affectedDateRange(a, b)).toEqual({
        start: '2026-05-10',
        end: '2026-06-03',
      });
    });

    it('returns null when nothing changed', () => {
      const a: PresenceScheduleLike = {
        recurringRuleKind: 'full_time',
        oneOffWindows: [{ start: '2026-05-10', end: '2026-05-12', label: 'Camp' }],
      };
      expect(affectedDateRange(a, a)).toBeNull();
    });

    it('returns null for an open-ended recurring-rule change (caller decides)', () => {
      const a: PresenceScheduleLike = { recurringRuleKind: 'full_time' };
      const b: PresenceScheduleLike = { recurringRuleKind: 'none' };
      expect(affectedDateRange(a, b)).toBeNull();
    });
  });
});
