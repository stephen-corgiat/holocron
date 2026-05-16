import { Repository } from 'typeorm';
import { AudibleWarningService } from './audible-warning.service';
import { RealtimeBus } from '../realtime/realtime-bus';
import { OccurrenceEntity } from '../tasks/occurrence.entity';
import { TaskEntity } from '../tasks/task.entity';
import { UserEntity } from '../users/user.entity';
import { HouseholdSettingsService } from '../household-settings/household-settings.service';
import { PresenceService } from '../presence/presence.service';

interface OccRow {
  id: string;
  userId: string;
  scheduledAt: Date;
  status: OccurrenceEntity['status'];
  task: { kind: 'reminder' | 'recurring' | 'windowed'; name: string };
}

function makeQueryBuilder(filteredRows: OccRow[]) {
  let userId = '';
  let statusEq: string | null = null;
  let kindNot: string | null = null;
  const qb: Record<string, unknown> = {
    leftJoinAndSelect() {
      return qb;
    },
    where(_clause: string, params?: Record<string, string>) {
      if (params?.userId) userId = params.userId;
      return qb;
    },
    andWhere(clause: string) {
      const statusMatch = /status\s*=\s*'(\w+)'/.exec(clause);
      if (statusMatch) statusEq = statusMatch[1];
      const kindNotMatch = /kind\s*<>\s*'(\w+)'/.exec(clause);
      if (kindNotMatch) kindNot = kindNotMatch[1];
      return qb;
    },
    async getMany() {
      return filteredRows.filter((r) => {
        if (userId && r.userId !== userId) return false;
        if (statusEq && r.status !== statusEq) return false;
        if (kindNot && r.task.kind === kindNot) return false;
        return true;
      });
    },
  };
  return qb;
}

function build(opts: {
  audibleAt?: string | null;
  lastFired?: string | null;
  rows?: OccRow[];
  restrictable?: UserEntity[];
  presenceSuppressed?: boolean;
}) {
  const rows = opts.rows ?? [];

  const occRepo = {
    createQueryBuilder: () => makeQueryBuilder(rows),
  } as unknown as Repository<OccurrenceEntity>;

  const restrictable = opts.restrictable ?? [
    {
      id: 'u-bob',
      isRestrictable: true,
      isAdmin: false,
      deactivatedAt: null,
    } as unknown as UserEntity,
  ];
  const usersRepo = {
    find: jest.fn(async () => restrictable),
  } as unknown as Repository<UserEntity>;

  const fired: string[] = [];
  const settingsState: { audibleAt: string | null; lastFired: string | null } = {
    audibleAt: opts.audibleAt ?? '20:00',
    lastFired: opts.lastFired ?? null,
  };
  const settings = {
    timeZone: async () => 'UTC',
    audibleWarningAt: async () => settingsState.audibleAt,
    audibleWarningLastFiredOn: async () => settingsState.lastFired,
    markAudibleWarningFired: async (date: string) => {
      settingsState.lastFired = date;
      fired.push(date);
    },
  } as unknown as HouseholdSettingsService;

  const presence = {
    findByUserId: async () => {
      if (opts.presenceSuppressed) {
        // resolver checks isSuppressed; rather than mocking resolver internals,
        // throwing is treated as "no schedule" upstream — so to simulate a
        // suppression we'd need a real-ish schedule. Tests cover the simpler
        // path where presence has no schedule.
        return null;
      }
      throw new Error('no schedule');
    },
  } as unknown as PresenceService;

  const bus = new RealtimeBus();
  const emit = jest.spyOn(bus, 'emit');

  const svc = new AudibleWarningService(
    occRepo,
    usersRepo,
    settings,
    presence,
    bus,
    { now: () => new Date() },
  );
  return { svc, fired, emit, settingsState };
}

describe('AudibleWarningService.tick', () => {
  const at8pm = new Date('2026-05-15T20:00:30Z');
  const at7pm = new Date('2026-05-15T19:00:00Z');

  it('fires when ≥1 Restrictable Trackee has an active non-reminder task', async () => {
    const { svc, emit, settingsState } = build({
      audibleAt: '20:00',
      rows: [
        {
          id: 'o-1',
          userId: 'u-bob',
          scheduledAt: at7pm,
          status: 'active',
          task: { kind: 'recurring', name: 'Test Task' },
        },
      ],
    });

    const fired = await svc.tick(at8pm);
    expect(fired).toBe(true);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(settingsState.lastFired).toBe('2026-05-15');
  });

  it('does not fire before the configured HH:MM', async () => {
    const { svc, emit } = build({
      audibleAt: '20:00',
      rows: [
        {
          id: 'o-1',
          userId: 'u-bob',
          scheduledAt: at7pm,
          status: 'active',
          task: { kind: 'recurring', name: 'Test Task' },
        },
      ],
    });
    expect(await svc.tick(at7pm)).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });

  it('does not fire when audible_warning_at is null', async () => {
    const { svc, emit } = build({ audibleAt: null });
    expect(await svc.tick(at8pm)).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });

  it('is idempotent within a single household-day', async () => {
    const { svc, emit } = build({
      audibleAt: '20:00',
      rows: [
        {
          id: 'o-1',
          userId: 'u-bob',
          scheduledAt: at7pm,
          status: 'active',
          task: { kind: 'recurring', name: 'Test Task' },
        },
      ],
    });
    expect(await svc.tick(at8pm)).toBe(true);
    expect(await svc.tick(at8pm)).toBe(false);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('excludes reminder-kind tasks', async () => {
    const { svc, emit } = build({
      audibleAt: '20:00',
      rows: [
        {
          id: 'o-1',
          userId: 'u-bob',
          scheduledAt: at7pm,
          status: 'active',
          task: { kind: 'reminder', name: 'Brush teeth' },
        },
      ],
    });
    expect(await svc.tick(at8pm)).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });

  it('excludes Excused / Deferred / Pending review / Complete / Missed', async () => {
    const states: OccurrenceEntity['status'][] = [
      'excused',
      'deferred',
      'pending_review',
      'complete',
      'missed',
    ];
    for (const state of states) {
      const { svc, emit } = build({
        audibleAt: '20:00',
        rows: [
          {
            id: `o-${state}`,
            userId: 'u-bob',
            scheduledAt: at7pm,
            status: state,
            task: { kind: 'recurring', name: 'Test Task' },
          },
        ],
      });
      expect(await svc.tick(at8pm)).toBe(false);
      expect(emit).not.toHaveBeenCalled();
    }
  });

  it('excludes non-Restrictable Trackees (admins / parents) entirely', async () => {
    const { svc, emit } = build({
      audibleAt: '20:00',
      restrictable: [],
      rows: [
        {
          id: 'o-1',
          userId: 'u-alice',
          scheduledAt: at7pm,
          status: 'active',
          task: { kind: 'recurring', name: 'Test Task' },
        },
      ],
    });
    expect(await svc.tick(at8pm)).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });
});
