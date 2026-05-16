import { Repository, DataSource } from 'typeorm';
import { PresenceReconciliationService } from './presence-reconciliation.service';
import { OccurrenceEntity } from '../tasks/occurrence.entity';
import { TaskEntity } from '../tasks/task.entity';
import { LadderPositionEntity } from '../tasks/ladder-position.entity';
import { DailyStreakEntity } from '../tasks/daily-streak.entity';
import { TransactionEntity } from '../transactions/transaction.entity';
import { UserEntity } from '../users/user.entity';
import { RealtimeBus } from '../realtime/realtime-bus';
import { PresenceScheduleLike } from './presence-resolver';

jest.mock('typeorm', () => {
  const actual = jest.requireActual('typeorm');
  return {
    ...actual,
    Between: (from: Date, to: Date) => ({ _from: from, _to: to }),
  };
});

class FakeOccurrenceRepo {
  rows: OccurrenceEntity[] = [];
  taskLookup: (id: string) => TaskEntity | undefined = () => undefined;
  create(p: Partial<OccurrenceEntity>): OccurrenceEntity {
    return { ...p } as OccurrenceEntity;
  }
  async save(entity: OccurrenceEntity): Promise<OccurrenceEntity> {
    const idx = this.rows.findIndex((r) => r.id === entity.id);
    if (idx >= 0) this.rows[idx] = entity;
    else this.rows.push(entity);
    return entity;
  }
  async update(where: { id: string }, patch: Partial<OccurrenceEntity>): Promise<void> {
    const row = this.rows.find((r) => r.id === where.id);
    if (row) Object.assign(row, patch);
  }
  async find(opts: {
    where: { userId?: string; scheduledAt?: { _from: Date; _to: Date } };
    relations?: Record<string, unknown>;
  }): Promise<OccurrenceEntity[]> {
    const matches = this.rows.filter((r) => {
      if (opts.where.userId && r.userId !== opts.where.userId) return false;
      if (opts.where.scheduledAt) {
        const range = opts.where.scheduledAt;
        if (r.scheduledAt < range._from || r.scheduledAt > range._to) return false;
      }
      return true;
    });
    if (opts.relations?.task) {
      for (const m of matches) m.task = this.taskLookup(m.taskId) as TaskEntity;
    }
    return matches;
  }
  async findOne(opts: { where: { id?: string } }): Promise<OccurrenceEntity | null> {
    return this.rows.find((r) => r.id === opts.where.id) ?? null;
  }
}

class FakeTransactionRepo {
  rows: TransactionEntity[] = [];
  private nextId = 1;
  create(p: Partial<TransactionEntity>): TransactionEntity {
    return { ...p } as TransactionEntity;
  }
  async save(entity: TransactionEntity): Promise<TransactionEntity> {
    if (!entity.id) {
      entity.id = 'txn-' + this.nextId++;
      entity.createdAt = entity.createdAt ?? new Date();
      this.rows.push(entity);
    }
    return entity;
  }
  async find(opts: {
    where: Partial<TransactionEntity>;
  }): Promise<TransactionEntity[]> {
    return this.rows.filter((r) =>
      Object.entries(opts.where).every(
        ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
      ),
    );
  }
}

class FakeLadderRepo {
  rows: LadderPositionEntity[] = [];
  create(p: Partial<LadderPositionEntity>): LadderPositionEntity {
    return { ...p } as LadderPositionEntity;
  }
  async save(entity: LadderPositionEntity): Promise<LadderPositionEntity> {
    const idx = this.rows.findIndex(
      (r) => r.taskId === entity.taskId && r.userId === entity.userId,
    );
    if (idx >= 0) this.rows[idx] = entity;
    else this.rows.push(entity);
    return entity;
  }
  async findOne(opts: {
    where: { taskId: string; userId: string };
  }): Promise<LadderPositionEntity | null> {
    return (
      this.rows.find(
        (r) =>
          r.taskId === opts.where.taskId && r.userId === opts.where.userId,
      ) ?? null
    );
  }
}

class FakeStreakRepo {
  row: DailyStreakEntity | null = null;
  create(p: Partial<DailyStreakEntity>): DailyStreakEntity {
    return { ...p } as DailyStreakEntity;
  }
  async save(entity: DailyStreakEntity): Promise<DailyStreakEntity> {
    this.row = entity;
    return entity;
  }
  async findOne(): Promise<DailyStreakEntity | null> {
    return this.row;
  }
}

class FakeUserRepo {
  constructor(private readonly users: UserEntity[]) {}
  async findOne(opts: { where: { id: string } }): Promise<UserEntity | null> {
    return this.users.find((u) => u.id === opts.where.id) ?? null;
  }
}

function fakeDataSource(
  occRepo: FakeOccurrenceRepo,
  txnRepo: FakeTransactionRepo,
  ladderRepo: FakeLadderRepo,
): DataSource {
  return {
    async transaction(work: (mgr: unknown) => Promise<void>): Promise<void> {
      const mgr = {
        getRepository(target: unknown) {
          if (target === OccurrenceEntity) return occRepo;
          if (target === TransactionEntity) return txnRepo;
          if (target === LadderPositionEntity) return ladderRepo;
          throw new Error('unknown repository');
        },
      };
      await work(mgr);
    },
  } as unknown as DataSource;
}

function makeUser(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: 'u-bob',
    displayName: 'Bob',
    isAdmin: false,
    isRestrictable: true,
    createdAt: new Date(),
    deactivatedAt: null,
    ...overrides,
  } as UserEntity;
}

function makeTask(overrides: Partial<TaskEntity> = {}): TaskEntity {
  return {
    id: 't-1',
    kind: 'recurring',
    name: 'Test Task',
    icon: null,
    dueTime: '08:00:00',
    recurrence: null,
    points: 5,
    ladder: [
      { points: 1, restriction: null },
      { points: 2, restriction: null },
      { points: 3, restriction: null },
    ],
    ladderResetThreshold: 3,
    active: true,
    requiresVerification: false,
    allowLateCompletion: false,
    lateWindowMinutes: 720,
    createdAt: new Date(),
    assignees: [],
    occurrences: [],
    ...overrides,
  } as TaskEntity;
}

function build() {
  const bob = makeUser();
  const userRepo = new FakeUserRepo([bob]) as unknown as Repository<UserEntity>;
  const occRepoFake = new FakeOccurrenceRepo();
  const task = makeTask();
  occRepoFake.taskLookup = (id) => (id === task.id ? task : undefined);
  const occRepo = occRepoFake as unknown as Repository<OccurrenceEntity>;
  const txnRepoFake = new FakeTransactionRepo();
  const txnRepo = txnRepoFake as unknown as Repository<TransactionEntity>;
  const ladderRepoFake = new FakeLadderRepo();
  const ladderRepo = ladderRepoFake as unknown as Repository<LadderPositionEntity>;
  const streakRepoFake = new FakeStreakRepo();
  const streakRepo = streakRepoFake as unknown as Repository<DailyStreakEntity>;
  const dataSource = fakeDataSource(occRepoFake, txnRepoFake, ladderRepoFake);

  const bus = new RealtimeBus();
  const resolutionSvc = {
    apply: jest.fn(async (occId: string) => {
      const row = occRepoFake.rows.find((r) => r.id === occId);
      if (row) row.status = 'missed';
      return { occurrence: row, result: { kind: 'effects' }, newOccurrenceId: null };
    }),
  } as unknown as import('../tasks/resolution').ResolutionService;

  const svc = new PresenceReconciliationService(
    dataSource,
    occRepo,
    txnRepo,
    ladderRepo,
    streakRepo,
    userRepo,
    resolutionSvc,
    bus,
    { now: () => new Date() },
    // Pin the household zone to UTC so day-boundary math is independent of the
    // process TZ the suite runs under.
    { timeZone: async () => 'UTC' } as unknown as import('../household-settings/household-settings.service').HouseholdSettingsService,
  );

  return { svc, bob, task, occRepoFake, txnRepoFake, ladderRepoFake, streakRepoFake, resolutionSvc };
}

describe('PresenceReconciliationService', () => {
  const NOW = new Date('2026-05-16T12:00:00');
  const VACATION = { start: '2026-05-10', end: '2026-05-12', label: 'Camp' };

  it('adding a retroactive vacation reverses past Misses', async () => {
    const { svc, bob, task, occRepoFake, txnRepoFake, ladderRepoFake } = build();
    // Past missed occurrence inside the vacation window.
    occRepoFake.rows.push({
      id: 'o-past',
      taskId: task.id,
      userId: bob.id,
      scheduledAt: new Date('2026-05-11T08:00:00'),
      status: 'missed',
    } as OccurrenceEntity);
    // Existing penalty transaction on that miss.
    txnRepoFake.rows.push({
      id: 'txn-pen',
      userId: bob.id,
      kind: 'penalty',
      amount: -2,
      occurrenceId: 'o-past',
      createdAt: new Date('2026-05-11T08:05:00'),
    } as TransactionEntity);
    // Ladder advanced to tier 2 from this miss.
    ladderRepoFake.rows.push({
      taskId: task.id,
      userId: bob.id,
      position: 2,
      cleanStreakCount: 0,
    } as LadderPositionEntity);

    const before: PresenceScheduleLike = { recurringRuleKind: 'full_time' };
    const after: PresenceScheduleLike = {
      recurringRuleKind: 'full_time',
      oneOffWindows: [VACATION],
    };
    const result = await svc.reconcileForUser(bob.id, before, after, NOW);

    expect(result.events.filter((e) => e.kind === 'LedgerReversal')).toHaveLength(1);
    // Claw-back posted.
    const clawBacks = txnRepoFake.rows.filter((t) => t.kind === 'claw_back');
    expect(clawBacks).toHaveLength(1);
    expect(clawBacks[0].amount).toBe(2);
    // Occurrence flipped back to active (derived suppression now renders Away).
    expect(occRepoFake.rows[0].status).toBe('active');
    // Ladder retracted by one tier.
    expect(ladderRepoFake.rows[0].position).toBe(1);
  });

  it('removing a vacation fires Misses for newly-no-longer-suppressed past occurrences', async () => {
    const { svc, bob, task, occRepoFake, resolutionSvc } = build();
    occRepoFake.rows.push({
      id: 'o-past',
      taskId: task.id,
      userId: bob.id,
      scheduledAt: new Date('2026-05-11T08:00:00'),
      status: 'active',
    } as OccurrenceEntity);

    const before: PresenceScheduleLike = {
      recurringRuleKind: 'full_time',
      oneOffWindows: [VACATION],
    };
    const after: PresenceScheduleLike = { recurringRuleKind: 'full_time' };
    const result = await svc.reconcileForUser(bob.id, before, after, NOW);

    expect(result.events.filter((e) => e.kind === 'MissFire')).toHaveLength(1);
    expect(resolutionSvc.apply).toHaveBeenCalledTimes(1);
    expect(occRepoFake.rows[0].status).toBe('missed');
  });

  it('reconciliation scope is bounded to the affected date range', async () => {
    const { svc, bob, task, occRepoFake } = build();
    // Past missed occurrence WAY outside the vacation window.
    occRepoFake.rows.push({
      id: 'o-far-past',
      taskId: task.id,
      userId: bob.id,
      scheduledAt: new Date('2025-01-01T08:00:00'),
      status: 'missed',
    } as OccurrenceEntity);

    const before: PresenceScheduleLike = { recurringRuleKind: 'full_time' };
    const after: PresenceScheduleLike = {
      recurringRuleKind: 'full_time',
      oneOffWindows: [VACATION],
    };
    const result = await svc.reconcileForUser(bob.id, before, after, NOW);

    // No events — the occurrence is outside the changed-window date range.
    expect(result.events).toHaveLength(0);
    expect(result.range).toEqual({
      start: new Date('2026-05-10T00:00:00.000Z'),
      end: new Date('2026-05-12T23:59:59.999Z'),
    });
  });

  it('no schedule diff: no work', async () => {
    const { svc, bob } = build();
    const same: PresenceScheduleLike = { recurringRuleKind: 'full_time' };
    const result = await svc.reconcileForUser(bob.id, same, same, NOW);
    expect(result.events).toHaveLength(0);
    expect(result.range).toBeNull();
  });
});
