import { Repository } from 'typeorm';
import { TasksService } from './tasks.service';
import { OccurrencesService } from './occurrences.service';
import { TaskEntity } from './task.entity';
import { OccurrenceEntity } from './occurrence.entity';
import { UserEntity } from '../users/user.entity';
import { TransactionEntity } from '../transactions/transaction.entity';
import { TransactionsService } from '../transactions/transactions.service';
import { RealtimeBus } from '../realtime/realtime-bus';

function makeUser(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: overrides.id ?? 'u-' + Math.random().toString(36).slice(2, 8),
    username: null,
    displayName: 'Trackee',
    passwordHash: null,
    isAdmin: false,
    isRestrictable: true,
    routerId: null,
    avatar: null,
    color: null,
    createdAt: new Date(),
    deactivatedAt: null,
    ...overrides,
  } as UserEntity;
}

class FakeUserRepo {
  constructor(private readonly users: UserEntity[]) {}
  async find(opts: { where: { id: { _value: string[] }; deactivatedAt: unknown } }): Promise<UserEntity[]> {
    // Crude In() detection: a wrapped value array on .id.
    const ids = (opts.where.id as unknown as { _value: string[] })._value;
    return this.users.filter((u) => ids.includes(u.id) && u.deactivatedAt === null);
  }
}

class FakeTaskRepo {
  rows: TaskEntity[] = [];
  private nextId = 1;
  create(partial: Partial<TaskEntity>): TaskEntity {
    return { ...partial } as TaskEntity;
  }
  async save(entity: TaskEntity): Promise<TaskEntity> {
    if (!entity.id) {
      entity.id = 't-' + this.nextId++;
      entity.createdAt = new Date();
      this.rows.push(entity);
    } else {
      const idx = this.rows.findIndex((r) => r.id === entity.id);
      if (idx >= 0) this.rows[idx] = entity;
      else this.rows.push(entity);
    }
    return entity;
  }
  async find(opts: { where?: Partial<TaskEntity> }): Promise<TaskEntity[]> {
    const w = opts.where ?? {};
    return this.rows.filter((r) =>
      Object.entries(w).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v),
    );
  }
  async findOne(opts: { where: Partial<TaskEntity> }): Promise<TaskEntity | null> {
    return (
      this.rows.find((r) =>
        Object.entries(opts.where).every(
          ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
        ),
      ) ?? null
    );
  }
}

class FakeOccurrenceRepo {
  rows: OccurrenceEntity[] = [];
  private nextId = 1;
  taskLookup: (id: string) => TaskEntity | undefined = () => undefined;
  create(partial: Partial<OccurrenceEntity>): OccurrenceEntity {
    return { ...partial } as OccurrenceEntity;
  }
  async save(entity: OccurrenceEntity): Promise<OccurrenceEntity> {
    if (!entity.id) {
      entity.id = 'o-' + this.nextId++;
      entity.updatedAt = new Date();
      this.rows.push(entity);
    } else {
      const idx = this.rows.findIndex((r) => r.id === entity.id);
      if (idx >= 0) this.rows[idx] = entity;
      else this.rows.push(entity);
    }
    return entity;
  }
  async update(
    criteria: { id: string },
    patch: Partial<OccurrenceEntity>,
  ): Promise<{ affected: number }> {
    const r = this.rows.find((x) => x.id === criteria.id);
    if (!r) return { affected: 0 };
    Object.assign(r, patch);
    return { affected: 1 };
  }
  async find(): Promise<OccurrenceEntity[]> {
    return [...this.rows];
  }
  async findOne(opts: {
    where: {
      id?: string;
      taskId?: string;
      userId?: string;
      localDay?: string;
    };
    relations?: Record<string, unknown>;
  }): Promise<OccurrenceEntity | null> {
    let match: OccurrenceEntity | undefined;
    if (opts.where.id) {
      match = this.rows.find((r) => r.id === opts.where.id);
    } else {
      match = this.rows.find(
        (r) =>
          r.taskId === opts.where.taskId &&
          r.userId === opts.where.userId &&
          r.localDay === opts.where.localDay,
      );
    }
    if (!match) return null;
    if (opts.relations?.task && match.taskId) {
      match.task = this.taskLookup(match.taskId) as TaskEntity;
    }
    return match;
  }
}

// Replicate typeorm's In() and Between() shape just enough for the fakes
// to pluck the parameters out — keeps the test set isolated from the driver.
jest.mock('typeorm', () => {
  const actual = jest.requireActual('typeorm');
  return {
    ...actual,
    In: (values: string[]) => ({ _value: values }),
    Between: (from: Date, to: Date) => ({ _from: from, _to: to }),
    IsNull: () => null,
  };
});

class FakeTransactionRepo {
  rows: TransactionEntity[] = [];
  private nextId = 1;
  create(partial: Partial<TransactionEntity>): TransactionEntity {
    return { ...partial } as TransactionEntity;
  }
  async save(entity: TransactionEntity): Promise<TransactionEntity> {
    if (!entity.id) {
      entity.id = 'txn-' + this.nextId++;
      entity.createdAt = new Date();
      this.rows.push(entity);
    }
    return entity;
  }
  async find(opts?: {
    where?: { occurrenceId?: string; kind?: string };
  }): Promise<TransactionEntity[]> {
    const where = opts?.where ?? {};
    return this.rows.filter((r) => {
      if (where.occurrenceId && r.occurrenceId !== where.occurrenceId) return false;
      if (where.kind && r.kind !== where.kind) return false;
      return true;
    });
  }
  createQueryBuilder() {
    const rows = this.rows;
    let userId: string | null = null;
    const qb = {
      select() {
        return qb;
      },
      where(_: string, params: { userId: string }) {
        userId = params.userId;
        return qb;
      },
      async getRawOne() {
        const sum = rows
          .filter((r) => r.userId === userId)
          .reduce((acc, r) => acc + r.amount, 0);
        return { sum };
      },
    };
    return qb;
  }
}

function makeServices() {
  const bob = makeUser({ id: 'u-bob', displayName: 'Bob' });
  const carol = makeUser({ id: 'u-carol', displayName: 'Carol' });
  const users = new FakeUserRepo([bob, carol]) as unknown as Repository<UserEntity>;
  const tasksRepoFake = new FakeTaskRepo();
  const tasksRepo = tasksRepoFake as unknown as Repository<TaskEntity>;
  const occRepoFake = new FakeOccurrenceRepo();
  occRepoFake.taskLookup = (id: string) => tasksRepoFake.rows.find((r) => r.id === id);
  const occRepo = occRepoFake as unknown as Repository<OccurrenceEntity>;
  const txnRepoFake = new FakeTransactionRepo();
  const txnRepo = txnRepoFake as unknown as Repository<TransactionEntity>;
  const tasksSvc = new TasksService(tasksRepo, users);
  const txnSvc = new TransactionsService(txnRepo);
  const bus = new RealtimeBus();
  const missSvc = { recordClean: async () => {} } as unknown as import('./miss.service').MissService;
  const presenceStub = {
    findByUserId: async () => {
      throw new Error('no schedule');
    },
  } as unknown as import('../presence/presence.service').PresenceService;
  const ladderRows: import('./ladder-position.entity').LadderPositionEntity[] = [];
  const ladderRepo = {
    findOne: async (opts: { where: { taskId: string; userId: string } }) =>
      ladderRows.find(
        (r) => r.taskId === opts.where.taskId && r.userId === opts.where.userId,
      ) ?? null,
    save: async (x: import('./ladder-position.entity').LadderPositionEntity) => {
      const idx = ladderRows.findIndex(
        (r) => r.taskId === x.taskId && r.userId === x.userId,
      );
      if (idx >= 0) ladderRows[idx] = x;
      else ladderRows.push(x);
      return x;
    },
    create: (partial: Partial<import('./ladder-position.entity').LadderPositionEntity>) =>
      ({ ...partial }) as import('./ladder-position.entity').LadderPositionEntity,
  } as unknown as Repository<import('./ladder-position.entity').LadderPositionEntity>;
  const streakRepo = {
    findOne: async () => null,
    save: async (x: unknown) => x,
  } as unknown as Repository<import('./daily-streak.entity').DailyStreakEntity>;
  const restrictionsStub = {
    applyMissCause: async () => undefined,
  } as unknown as import('../restrictions/restrictions.service').RestrictionsService;
  const liftStub = {
    applyLift: async () => ({ touchedRestrictionIds: [], liftedRestrictionIds: [] }),
  } as unknown as import('../restrictions/lift').LiftService;
  const dataSource = {
    transaction: async (fn: (m: unknown) => Promise<void>) => {
      const trx = {
        getRepository: (entity: unknown) => {
          if (entity === OccurrenceEntity) return occRepo;
          if (entity === TransactionEntity) return txnRepo;
          return ladderRepo;
        },
      };
      await fn(trx);
    },
  } as unknown as import('typeorm').DataSource;
  const clock = { now: () => new Date('2026-05-04T09:00:00.000Z') };
  const resolutionSvc = new (require('./resolution').ResolutionService)(
    dataSource,
    occRepo,
    ladderRepo,
    streakRepo,
    txnRepo,
    bus,
    restrictionsStub,
    liftStub,
    clock,
  );
  const occSvc = new OccurrencesService(
    occRepo,
    tasksSvc,
    txnSvc,
    missSvc,
    resolutionSvc,
    presenceStub,
    clock,
    // Pin household tz to UTC so day math is independent of the process TZ.
    { timeZone: async () => 'UTC' } as unknown as import('../household-settings/household-settings.service').HouseholdSettingsService,
  );
  return {
    tasksSvc,
    occSvc,
    txnSvc,
    bus,
    bob,
    carol,
    tasksRepo,
    occRepo,
    txnRepoFake,
  };
}

describe('OccurrencesService.generateForDate', () => {
  it('creates one occurrence per assigned Trackee per day for an active reminder task', async () => {
    const { tasksSvc, occSvc, bob, carol, occRepo } = makeServices();
    await tasksSvc.createReminder({
      name: 'Eat breakfast',
      dueTime: '08:00',
      assigneeIds: [bob.id, carol.id],
    });
    await occSvc.generateForDate(new Date('2026-05-14T05:00:00Z'));
    const fakeRepo = occRepo as unknown as FakeOccurrenceRepo;
    expect(fakeRepo.rows).toHaveLength(2);
    expect(fakeRepo.rows.map((r) => r.userId).sort()).toEqual(
      [bob.id, carol.id].sort(),
    );
  });

  it('is idempotent — re-running for the same date produces no duplicates', async () => {
    const { tasksSvc, occSvc, bob, occRepo } = makeServices();
    await tasksSvc.createReminder({
      name: 'Go to bed',
      dueTime: '21:00',
      assigneeIds: [bob.id],
    });
    const day = new Date('2026-05-14T05:00:00');
    await occSvc.generateForDate(day);
    await occSvc.generateForDate(day);
    const fakeRepo = occRepo as unknown as FakeOccurrenceRepo;
    expect(fakeRepo.rows).toHaveLength(1);
  });

  it('skips inactive tasks', async () => {
    const { tasksSvc, occSvc, bob, occRepo } = makeServices();
    const task = await tasksSvc.createReminder({
      name: 'Defunct',
      dueTime: '07:00',
      assigneeIds: [bob.id],
    });
    await tasksSvc.update(task.id, { active: false });
    await occSvc.generateForDate(new Date('2026-05-14T05:00:00Z'));
    expect((occRepo as unknown as FakeOccurrenceRepo).rows).toHaveLength(0);
  });

  it('generates a recurring occurrence on a day the pattern fires', async () => {
    const { tasksSvc, occSvc, bob, occRepo } = makeServices();
    await tasksSvc.createRecurring({
      name: 'Test Task',
      dueTime: '08:00',
      recurrence: { preset: 'daily' },
      points: 5,
      assigneeIds: [bob.id],
    });
    await occSvc.generateForDate(new Date('2026-05-14T05:00:00Z'));
    expect((occRepo as unknown as FakeOccurrenceRepo).rows).toHaveLength(1);
  });

  it('does NOT generate a recurring occurrence on a day the pattern skips', async () => {
    const { tasksSvc, occSvc, bob, occRepo } = makeServices();
    await tasksSvc.createRecurring({
      name: 'Test Task',
      dueTime: '08:00',
      // 2026-05-16 is a Saturday — weekdays preset should NOT fire.
      recurrence: { preset: 'weekdays' },
      points: 5,
      assigneeIds: [bob.id],
    });
    await occSvc.generateForDate(new Date('2026-05-16T05:00:00Z'));
    expect((occRepo as unknown as FakeOccurrenceRepo).rows).toHaveLength(0);
  });

  it('a recurrence-bearing reminder fires only on its cadence days', async () => {
    const { tasksSvc, occSvc, bob, occRepo } = makeServices();
    await tasksSvc.createReminder({
      name: 'Eat breakfast',
      dueTime: '08:00',
      recurrence: { preset: 'weekdays' },
      assigneeIds: [bob.id],
    });
    const fakeRepo = occRepo as unknown as FakeOccurrenceRepo;
    // 2026-05-14 is a Thursday — weekdays fires.
    await occSvc.generateForDate(new Date('2026-05-14T05:00:00Z'));
    expect(fakeRepo.rows).toHaveLength(1);
    // 2026-05-16 is a Saturday — weekdays skips.
    await occSvc.generateForDate(new Date('2026-05-16T05:00:00Z'));
    expect(fakeRepo.rows).toHaveLength(1);
  });

  it('a reminder with no recurrence still fires every day (back-compat)', async () => {
    const { tasksSvc, occSvc, bob, occRepo } = makeServices();
    await tasksSvc.createReminder({
      name: 'Eat breakfast',
      dueTime: '08:00',
      assigneeIds: [bob.id],
    });
    const fakeRepo = occRepo as unknown as FakeOccurrenceRepo;
    // Saturday: a null-recurrence reminder is the legacy "every day" behavior.
    await occSvc.generateForDate(new Date('2026-05-16T05:00:00Z'));
    expect(fakeRepo.rows).toHaveLength(1);
  });
});

describe('OccurrencesService.markComplete', () => {
  it('transitions a recurring occurrence to complete and posts an earn transaction', async () => {
    const { tasksSvc, occSvc, bob, occRepo, txnRepoFake } = makeServices();
    const task = await tasksSvc.createRecurring({
      name: 'Test Task',
      dueTime: '08:00',
      recurrence: { preset: 'daily' },
      points: 7,
      assigneeIds: [bob.id],
    });
    await occSvc.generateForDate(new Date('2026-05-14T05:00:00Z'));
    const fakeRepo = occRepo as unknown as FakeOccurrenceRepo;
    const occ = fakeRepo.rows[0];

    await occSvc.markComplete(occ.id);

    expect(occ.status).toBe('complete');
    expect(txnRepoFake.rows).toHaveLength(1);
    expect(txnRepoFake.rows[0]).toMatchObject({
      userId: bob.id,
      kind: 'earn',
      amount: 7,
      reason: 'Test Task',
      occurrenceId: occ.id,
    });
    void task;
  });

  it('is idempotent — a second markComplete does not double-credit', async () => {
    const { tasksSvc, occSvc, bob, occRepo, txnRepoFake } = makeServices();
    await tasksSvc.createRecurring({
      name: 'Test Task',
      dueTime: '08:00',
      recurrence: { preset: 'daily' },
      points: 3,
      assigneeIds: [bob.id],
    });
    await occSvc.generateForDate(new Date('2026-05-14T05:00:00Z'));
    const occ = (occRepo as unknown as FakeOccurrenceRepo).rows[0];

    await occSvc.markComplete(occ.id);
    await occSvc.markComplete(occ.id);

    expect(txnRepoFake.rows).toHaveLength(1);
  });

  it('refuses to mark a reminder occurrence complete via the recurring endpoint', async () => {
    const { tasksSvc, occSvc, bob, occRepo } = makeServices();
    await tasksSvc.createReminder({
      name: 'Reminder task',
      dueTime: '08:00',
      assigneeIds: [bob.id],
    });
    await occSvc.generateForDate(new Date('2026-05-14T05:00:00Z'));
    const occ = (occRepo as unknown as FakeOccurrenceRepo).rows[0];
    await expect(occSvc.markComplete(occ.id)).rejects.toThrow();
  });
});
