import { Repository, DataSource } from 'typeorm';
import { OccurrenceActionsService } from './occurrence-actions.service';
import { OccurrenceEntity } from './occurrence.entity';
import { TaskEntity } from './task.entity';
import { TransactionEntity } from '../transactions/transaction.entity';
import { LadderPositionEntity } from './ladder-position.entity';
import { DailyStreakEntity } from './daily-streak.entity';
import { UserEntity } from '../users/user.entity';
import { RealtimeBus } from '../realtime/realtime-bus';
import { MissService } from './miss.service';
import { OccurrencesService } from './occurrences.service';
import { TasksService } from './tasks.service';
import { TransactionsService } from '../transactions/transactions.service';
import { ResolutionService } from './resolution';

jest.mock('typeorm', () => {
  const actual = jest.requireActual('typeorm');
  return {
    ...actual,
    In: (values: string[]) => ({ _value: values }),
    Between: (from: Date, to: Date) => ({ _from: from, _to: to }),
    IsNull: () => null,
    LessThan: (cutoff: Date) => ({ _lt: cutoff }),
    LessThanOrEqual: (cutoff: Date) => ({ _lte: cutoff }),
  };
});

function makeUser(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: overrides.id ?? 'u-' + Math.random().toString(36).slice(2, 8),
    username: null,
    displayName: overrides.displayName ?? 'Trackee',
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
  async findOne(opts: { where: { id: string } }): Promise<UserEntity | null> {
    return this.users.find((u) => u.id === opts.where.id) ?? null;
  }
  async find(opts?: {
    where?: { id?: { _value: string[] }; deactivatedAt?: unknown };
  }): Promise<UserEntity[]> {
    if (!opts?.where?.id) return this.users;
    const ids = (opts.where.id as { _value: string[] })._value;
    return this.users.filter(
      (u) => ids.includes(u.id) && u.deactivatedAt === null,
    );
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
  async find(opts: { where?: Partial<TaskEntity> } = {}): Promise<TaskEntity[]> {
    const w = opts.where ?? {};
    return this.rows.filter((r) =>
      Object.entries(w).every(
        ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
      ),
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
  userLookup: (id: string) => UserEntity | undefined = () => undefined;
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
    where: { id: string },
    patch: Partial<OccurrenceEntity>,
  ): Promise<void> {
    const row = this.rows.find((r) => r.id === where.id);
    if (row) Object.assign(row, patch);
  }
  async find(opts: {
    where: Partial<OccurrenceEntity> & { scheduledAt?: { _lte?: Date; _from?: Date; _to?: Date } };
    relations?: Record<string, unknown>;
  }): Promise<OccurrenceEntity[]> {
    const w = opts.where ?? {};
    const matches = this.rows.filter((r) => {
      for (const [k, v] of Object.entries(w)) {
        if (k === 'scheduledAt') {
          const sa = v as { _lte?: Date; _from?: Date; _to?: Date };
          if (sa._lte && r.scheduledAt > sa._lte) return false;
          if (sa._from && r.scheduledAt < sa._from) return false;
          if (sa._to && r.scheduledAt > sa._to) return false;
          continue;
        }
        if ((r as unknown as Record<string, unknown>)[k] !== v) return false;
      }
      return true;
    });
    if (opts.relations?.task) {
      for (const m of matches) m.task = this.taskLookup(m.taskId) as TaskEntity;
    }
    if (opts.relations?.user) {
      for (const m of matches) m.user = this.userLookup(m.userId) as UserEntity;
    }
    return matches;
  }
  async findOne(opts: {
    where: { id?: string };
    relations?: Record<string, unknown>;
  }): Promise<OccurrenceEntity | null> {
    const m = this.rows.find((r) => r.id === opts.where.id);
    if (!m) return null;
    if (opts.relations?.task) m.task = this.taskLookup(m.taskId) as TaskEntity;
    if (opts.relations?.user) m.user = this.userLookup(m.userId) as UserEntity;
    return m;
  }
  // Minimal query-builder stub used by MissService.fireDeadlineTick — see
  // pending-review.service.spec for the same stub.
  createQueryBuilder(_alias: string) {
    const taskLookup = this.taskLookup;
    const userLookup = this.userLookup;
    let nowFilter: Date | null = null;
    const self = this;
    const qb = {
      leftJoinAndSelect() {
        return qb;
      },
      where() {
        return qb;
      },
      andWhere(_clause: string, p?: Record<string, unknown>) {
        if (p && 'now' in p) nowFilter = p['now'] as Date;
        return qb;
      },
      orderBy() {
        return qb;
      },
      async getMany(): Promise<OccurrenceEntity[]> {
        const out = self.rows.filter((r) => {
          if (r.status !== 'active') return false;
          if (!nowFilter) return true;
          const deadline = r.windowEnd ?? r.scheduledAt;
          return deadline.getTime() <= nowFilter.getTime();
        });
        for (const m of out) {
          m.task = taskLookup(m.taskId) as TaskEntity;
          m.user = userLookup(m.userId) as UserEntity;
        }
        return out;
      },
    };
    return qb;
  }
}

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
  async find(opts: {
    where: Partial<TransactionEntity>;
  }): Promise<TransactionEntity[]> {
    const w = opts.where;
    return this.rows.filter((r) =>
      Object.entries(w).every(
        ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
      ),
    );
  }
}

class FakeLadderPositionRepo {
  rows: LadderPositionEntity[] = [];
  create(partial: Partial<LadderPositionEntity>): LadderPositionEntity {
    return { ...partial } as LadderPositionEntity;
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

class FakeDailyStreakRepo {
  rows: DailyStreakEntity[] = [];
  create(partial: Partial<DailyStreakEntity>): DailyStreakEntity {
    return { ...partial } as DailyStreakEntity;
  }
  async save(entity: DailyStreakEntity): Promise<DailyStreakEntity> {
    const idx = this.rows.findIndex((r) => r.userId === entity.userId);
    if (idx >= 0) this.rows[idx] = entity;
    else this.rows.push(entity);
    return entity;
  }
  async findOne(opts: {
    where: { userId: string };
  }): Promise<DailyStreakEntity | null> {
    return this.rows.find((r) => r.userId === opts.where.userId) ?? null;
  }
}

function fakeDataSource(
  occRepo: FakeOccurrenceRepo,
  txnRepo: FakeTransactionRepo,
  ladderRepo: FakeLadderPositionRepo,
  streakRepo: FakeDailyStreakRepo,
): DataSource {
  return {
    async transaction(work: (mgr: unknown) => Promise<void>): Promise<void> {
      const mgr = {
        getRepository(target: { name?: string }) {
          if (target === OccurrenceEntity) return occRepo;
          if (target === TransactionEntity) return txnRepo;
          if (target === LadderPositionEntity) return ladderRepo;
          if (target === DailyStreakEntity) return streakRepo;
          throw new Error(`unknown repository ${target.name ?? 'anon'}`);
        },
      };
      await work(mgr);
    },
  } as unknown as DataSource;
}

function build() {
  const alice = makeUser({
    id: 'u-alice',
    displayName: 'Alice',
    isAdmin: true,
    isRestrictable: false,
  });
  const bob = makeUser({
    id: 'u-bob',
    displayName: 'Bob',
    isRestrictable: true,
  });
  const users = [alice, bob];
  const userRepoFake = new FakeUserRepo(users);
  const userRepo = userRepoFake as unknown as Repository<UserEntity>;
  const tasksRepoFake = new FakeTaskRepo();
  const tasksRepo = tasksRepoFake as unknown as Repository<TaskEntity>;
  const occRepoFake = new FakeOccurrenceRepo();
  occRepoFake.taskLookup = (id) => tasksRepoFake.rows.find((r) => r.id === id);
  occRepoFake.userLookup = (id) => users.find((u) => u.id === id);
  const occRepo = occRepoFake as unknown as Repository<OccurrenceEntity>;
  const txnRepoFake = new FakeTransactionRepo();
  const txnRepo = txnRepoFake as unknown as Repository<TransactionEntity>;
  const ladderRepoFake = new FakeLadderPositionRepo();
  const ladderRepo = ladderRepoFake as unknown as Repository<LadderPositionEntity>;
  const streakRepoFake = new FakeDailyStreakRepo();
  const streakRepo = streakRepoFake as unknown as Repository<DailyStreakEntity>;

  const bus = new RealtimeBus();
  const tasksSvc = new TasksService(tasksRepo, userRepo);
  const txnSvc = new TransactionsService(txnRepo);
  const dataSource = fakeDataSource(
    occRepoFake,
    txnRepoFake,
    ladderRepoFake,
    streakRepoFake,
  );
  const presenceStub = {
    findByUserId: async () => {
      throw new Error('no schedule');
    },
  } as unknown as import('../presence/presence.service').PresenceService;
  const restrictionsStub = {
    applyMissCause: async () => undefined,
  } as unknown as import('../restrictions/restrictions.service').RestrictionsService;
  const liftStub = {
    applyLift: async () => ({
      touchedRestrictionIds: [],
      liftedRestrictionIds: [],
    }),
  } as unknown as import('../restrictions/lift').LiftService;
  let clockNow = new Date();
  const clock = {
    now: () => clockNow,
    setNow: (d: Date) => {
      clockNow = d;
    },
  };
  const resolutionSvc = new ResolutionService(
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
  const missSvc = new MissService(
    occRepo,
    bus,
    presenceStub,
    resolutionSvc,
  );
  const occSvc = new OccurrencesService(
    occRepo,
    tasksSvc,
    txnSvc,
    missSvc,
    resolutionSvc,
    presenceStub,
    clock,
    { timeZone: async () => 'UTC' } as unknown as import('../household-settings/household-settings.service').HouseholdSettingsService,
  );
  const actionsSvc = new OccurrenceActionsService(occRepo, resolutionSvc, {
    // Pin household tz to UTC so due_time math is independent of the suite's
    // process TZ.
    timeZone: async () => 'UTC',
  } as unknown as import('../household-settings/household-settings.service').HouseholdSettingsService);

  return {
    alice,
    bob,
    tasksSvc,
    occSvc,
    missSvc,
    actionsSvc,
    tasksRepoFake,
    occRepoFake,
    txnRepoFake,
    ladderRepoFake,
    streakRepoFake,
    clock,
  };
}

async function setupRecurringTask(
  ctx: ReturnType<typeof build>,
  options: { ladder?: Array<{ points: number }> } = {},
) {
  const task = await ctx.tasksSvc.createRecurring({
    name: 'Test Task',
    dueTime: '08:00',
    recurrence: { preset: 'daily' },
    points: 7,
    requiresVerification: false,
    ladder: options.ladder?.map((t) => ({ points: t.points, restriction: null })) ?? [
      { points: 3, restriction: null },
      { points: 5, restriction: null },
    ],
    assigneeIds: [ctx.bob.id],
  });
  await ctx.occSvc.generateForDate(new Date('2026-05-14T05:00:00Z'));
  const occ = ctx.occRepoFake.rows[0];
  return { task, occ };
}

describe('OccurrenceActionsService.excuse', () => {
  it('pre-deadline: flips status to excused with no ledger or ladder side effects', async () => {
    const ctx = build();
    const { occ } = await setupRecurringTask(ctx);

    await ctx.actionsSvc.excuse(occ.id, ctx.alice.id);

    expect(occ.status).toBe('excused');
    expect(ctx.txnRepoFake.rows).toHaveLength(0);
    expect(ctx.ladderRepoFake.rows).toHaveLength(0);
  });

  it('post-miss: reverses penalty (claw_back) and retracts ladder position under one txn_group_id', async () => {
    const ctx = build();
    const { occ } = await setupRecurringTask(ctx, {
      ladder: [{ points: 3 }, { points: 5 }],
    });

    // Drive the deadline tick to fire a Miss.
    const wayPastDue = new Date(occ.scheduledAt.getTime() + 24 * 3600_000);
    await ctx.missSvc.fireDeadlineTick(wayPastDue);
    expect(occ.status).toBe('missed');
    const penalty = ctx.txnRepoFake.rows.find((t) => t.kind === 'penalty');
    expect(penalty).toBeDefined();
    expect(penalty!.amount).toBe(-3);
    expect(ctx.ladderRepoFake.rows[0].position).toBe(2);

    await ctx.actionsSvc.excuse(occ.id, ctx.alice.id);

    expect(occ.status).toBe('excused');
    const clawback = ctx.txnRepoFake.rows.find((t) => t.kind === 'claw_back');
    expect(clawback).toBeDefined();
    expect(clawback!.amount).toBe(3);
    expect(clawback!.txnGroupId).toBeTruthy();
    expect(clawback!.occurrenceId).toBe(occ.id);
    expect(ctx.ladderRepoFake.rows[0].position).toBe(1);
  });

  it('is idempotent: re-excusing an already-excused occurrence is a no-op', async () => {
    const ctx = build();
    const { occ } = await setupRecurringTask(ctx);
    await ctx.actionsSvc.excuse(occ.id, ctx.alice.id);
    const txnCountBefore = ctx.txnRepoFake.rows.length;
    await ctx.actionsSvc.excuse(occ.id, ctx.alice.id);
    expect(ctx.txnRepoFake.rows).toHaveLength(txnCountBefore);
    expect(occ.status).toBe('excused');
  });
});

describe('OccurrenceActionsService.defer', () => {
  it('marks the original deferred and creates a new occurrence linked via deferred_from_occurrence_id', async () => {
    const ctx = build();
    const { task, occ } = await setupRecurringTask(ctx);
    const future = new Date(Date.now() + 7 * 86400_000);
    future.setUTCHours(12, 0, 0, 0);

    const result = await ctx.actionsSvc.defer(occ.id, future, ctx.alice.id);

    expect(result.original.status).toBe('deferred');
    expect(result.deferred.status).toBe('active');
    expect(result.deferred.deferredFromOccurrenceId).toBe(occ.id);
    expect(result.deferred.taskId).toBe(task.id);
    expect(result.deferred.userId).toBe(ctx.bob.id);
    // New occurrence is on the requested date at the task's due_time, read in
    // the household zone (UTC here) so the assertion doesn't depend on the
    // process TZ.
    expect(result.deferred.scheduledAt.getUTCFullYear()).toBe(future.getUTCFullYear());
    expect(result.deferred.scheduledAt.getUTCMonth()).toBe(future.getUTCMonth());
    expect(result.deferred.scheduledAt.getUTCDate()).toBe(future.getUTCDate());
    expect(result.deferred.scheduledAt.getUTCHours()).toBe(8);
    expect(ctx.occRepoFake.rows).toHaveLength(2);
  });

  it('rejects a past-dated defer target', async () => {
    const ctx = build();
    const { occ } = await setupRecurringTask(ctx);
    const past = new Date(Date.now() - 86400_000);
    await expect(
      ctx.actionsSvc.defer(occ.id, past, ctx.alice.id),
    ).rejects.toThrow();
  });
});

describe('OccurrenceActionsService.lateComplete — ADR-0001 four-effect undo', () => {
  it('flips status to complete, refunds the penalty as claw_back, and retracts the ladder advance', async () => {
    const ctx = build();
    const { occ } = await setupRecurringTask(ctx, {
      ladder: [{ points: 3 }, { points: 5 }],
    });

    // Fire the Miss.
    const justPastDue = new Date(occ.scheduledAt.getTime() + 60 * 60_000);
    await ctx.missSvc.fireDeadlineTick(justPastDue);
    expect(occ.status).toBe('missed');
    expect(ctx.ladderRepoFake.rows[0].position).toBe(2);
    const penalty = ctx.txnRepoFake.rows.find((t) => t.kind === 'penalty');
    expect(penalty!.amount).toBe(-3);

    // Late-complete inside the (default 720m) window.
    const withinWindow = new Date(occ.scheduledAt.getTime() + 2 * 60 * 60_000);
    ctx.clock.setNow(withinWindow);
    await ctx.actionsSvc.lateComplete(occ.id);

    expect(occ.status).toBe('complete');
    const clawback = ctx.txnRepoFake.rows.find((t) => t.kind === 'claw_back');
    expect(clawback).toBeDefined();
    expect(clawback!.amount).toBe(3);
    expect(clawback!.occurrenceId).toBe(occ.id);
    expect(clawback!.txnGroupId).toBeTruthy();
    expect(ctx.ladderRepoFake.rows[0].position).toBe(1);
  });

  it('rejects when the task has allow_late_completion=false', async () => {
    const ctx = build();
    const task = await ctx.tasksSvc.createRecurring({
      name: 'Test Task',
      dueTime: '08:00',
      recurrence: { preset: 'daily' },
      points: 7,
      ladder: [{ points: 3, restriction: null }],
      allowLateCompletion: false,
      assigneeIds: [ctx.bob.id],
    });
    await ctx.occSvc.generateForDate(new Date('2026-05-14T05:00:00Z'));
    const occ = ctx.occRepoFake.rows[0];
    expect(task.allowLateCompletion).toBe(false);

    const justPastDue = new Date(occ.scheduledAt.getTime() + 60 * 60_000);
    await ctx.missSvc.fireDeadlineTick(justPastDue);
    expect(occ.status).toBe('missed');

    ctx.clock.setNow(justPastDue);
    await expect(
      ctx.actionsSvc.lateComplete(occ.id),
    ).rejects.toThrow(/does not allow late completion/);
    expect(occ.status).toBe('missed');
  });

  it('rejects after the late window closes', async () => {
    const ctx = build();
    const { occ } = await setupRecurringTask(ctx);
    const justPastDue = new Date(occ.scheduledAt.getTime() + 60 * 60_000);
    await ctx.missSvc.fireDeadlineTick(justPastDue);

    // Default window is 720m (12h). Wait 13h.
    const afterWindow = new Date(occ.scheduledAt.getTime() + 13 * 60 * 60_000);
    ctx.clock.setNow(afterWindow);
    await expect(
      ctx.actionsSvc.lateComplete(occ.id),
    ).rejects.toThrow(/late window has closed/);
    expect(occ.status).toBe('missed');
  });

  it('rejects when the occurrence is not in missed state', async () => {
    const ctx = build();
    const { occ } = await setupRecurringTask(ctx);
    // still active, not missed
    await expect(ctx.actionsSvc.lateComplete(occ.id)).rejects.toThrow(/missed/);
  });

  it('ladder retraction with single-tier ladder leaves position at 1 (no underflow)', async () => {
    const ctx = build();
    const { occ } = await setupRecurringTask(ctx, {
      ladder: [{ points: 4 }],
    });
    const justPastDue = new Date(occ.scheduledAt.getTime() + 60 * 60_000);
    await ctx.missSvc.fireDeadlineTick(justPastDue);
    // Single-tier ladder: position stays at 1 (terminal).
    expect(ctx.ladderRepoFake.rows[0].position).toBe(1);

    ctx.clock.setNow(justPastDue);
    await ctx.actionsSvc.lateComplete(occ.id);
    expect(ctx.ladderRepoFake.rows[0].position).toBe(1);
  });
});

describe('MissService.fireDeadlineTick — excused/deferred suppression', () => {
  it('does not fire a Miss for an excused occurrence past its deadline', async () => {
    const ctx = build();
    const { occ } = await setupRecurringTask(ctx);
    await ctx.actionsSvc.excuse(occ.id, ctx.alice.id);

    const wayPastDue = new Date(occ.scheduledAt.getTime() + 24 * 3600_000);
    const result = await ctx.missSvc.fireDeadlineTick(wayPastDue);

    expect(result.fired).toBe(0);
    expect(occ.status).toBe('excused');
    expect(ctx.txnRepoFake.rows.filter((t) => t.kind === 'penalty')).toHaveLength(0);
  });

  it('does not fire a Miss for a deferred occurrence past its deadline', async () => {
    const ctx = build();
    const { occ } = await setupRecurringTask(ctx);
    const future = new Date(Date.now() + 7 * 86400_000);
    future.setUTCHours(12, 0, 0, 0);
    await ctx.actionsSvc.defer(occ.id, future, ctx.alice.id);

    const wayPastDue = new Date(occ.scheduledAt.getTime() + 24 * 3600_000);
    const result = await ctx.missSvc.fireDeadlineTick(wayPastDue);

    // Original is now `deferred` and the new occurrence is in the future, so
    // neither fires.
    expect(result.fired).toBe(0);
    expect(occ.status).toBe('deferred');
  });
});

describe('Windowed task (kind=windowed)', () => {
  it('createWindowed (recurring) forces allow_late_completion=false and stores offsets', async () => {
    const ctx = build();
    const task = await ctx.tasksSvc.createWindowed({
      name: 'Test Task',
      recurrence: { preset: 'weekends' },
      windowStartOffsetMinutes: 9 * 60,
      windowEndOffsetMinutes: 21 * 60,
      points: 5,
      assigneeIds: [ctx.bob.id],
    });
    expect(task.kind).toBe('windowed');
    expect(task.allowLateCompletion).toBe(false);
    expect(task.windowStartOffsetMinutes).toBe(540);
    expect(task.windowEndOffsetMinutes).toBe(1260);
  });

  it('createWindowed (one-shot) rejects without window_start / window_end', async () => {
    const ctx = build();
    await expect(
      ctx.tasksSvc.createWindowed({
        name: 'Test Task',
        recurrence: null,
        points: 5,
        assigneeIds: [ctx.bob.id],
      }),
    ).rejects.toThrow(/window_start.*window_end/);
  });

  it('createWindowed (recurring) rejects when end_offset <= start_offset', async () => {
    const ctx = build();
    await expect(
      ctx.tasksSvc.createWindowed({
        name: 'Test Task',
        recurrence: { preset: 'daily' },
        windowStartOffsetMinutes: 9 * 60,
        windowEndOffsetMinutes: 9 * 60,
        points: 5,
        assigneeIds: [ctx.bob.id],
      }),
    ).rejects.toThrow(/window_end_offset_minutes/);
  });

  it('one-shot windowed task fires the Miss at window_end (not earlier)', async () => {
    const ctx = build();
    const task = await ctx.tasksSvc.createWindowed({
      name: 'Test Task',
      recurrence: null,
      windowStart: '2026-05-15T09:00:00Z',
      windowEnd: '2026-05-15T21:00:00Z',
      points: 5,
      ladder: [{ points: 3, restriction: null }],
      assigneeIds: [ctx.bob.id],
    });
    // Manually materialize the one-shot occurrence (controller does this in
    // production). Re-fetch the task to pick up the assignees relation.
    const fresh = await ctx.tasksSvc.findById(task.id);
    await ctx.occSvc.createOneShotWindowedOccurrence(
      fresh,
      new Date('2026-05-15T09:00:00Z'),
      new Date('2026-05-15T21:00:00Z'),
    );
    const occ = ctx.occRepoFake.rows[0];
    expect(occ.scheduledAt.toISOString()).toBe('2026-05-15T09:00:00.000Z');
    expect(occ.windowEnd?.toISOString()).toBe('2026-05-15T21:00:00.000Z');

    // Inside the window — no miss.
    const midWindow = new Date('2026-05-15T15:00:00Z');
    let result = await ctx.missSvc.fireDeadlineTick(midWindow);
    expect(result.fired).toBe(0);
    expect(occ.status).toBe('active');

    // Past window_end — miss fires.
    const past = new Date('2026-05-15T21:00:01Z');
    result = await ctx.missSvc.fireDeadlineTick(past);
    expect(result.fired).toBe(1);
    expect(occ.status).toBe('missed');
    const penalty = ctx.txnRepoFake.rows.find((t) => t.kind === 'penalty');
    expect(penalty!.amount).toBe(-3);
  });

  it('recurring windowed task materializes one occurrence per cadence cycle, miss fires each cycle', async () => {
    const ctx = build();
    await ctx.tasksSvc.createWindowed({
      name: 'Test Task',
      // Weekly cadence on Saturday (DOW=6) for predictability.
      recurrence: { preset: 'weekly', days: [6] },
      windowStartOffsetMinutes: 9 * 60,
      windowEndOffsetMinutes: 21 * 60,
      points: 4,
      ladder: [{ points: 2, restriction: null }],
      assigneeIds: [ctx.bob.id],
    });

    // 2026-05-16 is a Saturday. generateForDate hits the cadence and creates
    // one occurrence with window 09:00 → 21:00 local.
    await ctx.occSvc.generateForDate(new Date('2026-05-16T05:00:00Z'));
    expect(ctx.occRepoFake.rows).toHaveLength(1);
    const occ1 = ctx.occRepoFake.rows[0];
    expect(occ1.windowEnd).toBeTruthy();

    // Past window_end → miss fires.
    const past = new Date(occ1.windowEnd!.getTime() + 60_000);
    await ctx.missSvc.fireDeadlineTick(past);
    expect(occ1.status).toBe('missed');

    // Next Saturday: another cycle, another occurrence, another miss.
    await ctx.occSvc.generateForDate(new Date('2026-05-23T05:00:00Z'));
    expect(ctx.occRepoFake.rows).toHaveLength(2);
    const occ2 = ctx.occRepoFake.rows[1];
    expect(occ2.status).toBe('active');
    const past2 = new Date(occ2.windowEnd!.getTime() + 60_000);
    await ctx.missSvc.fireDeadlineTick(past2);
    expect(occ2.status).toBe('missed');
  });

  it('late-complete is rejected on a missed windowed occurrence (no late-completion path)', async () => {
    const ctx = build();
    const task = await ctx.tasksSvc.createWindowed({
      name: 'Test Task',
      recurrence: null,
      windowStart: '2026-05-15T09:00:00Z',
      windowEnd: '2026-05-15T21:00:00Z',
      points: 5,
      ladder: [{ points: 3, restriction: null }],
      assigneeIds: [ctx.bob.id],
    });
    const fresh = await ctx.tasksSvc.findById(task.id);
    await ctx.occSvc.createOneShotWindowedOccurrence(
      fresh,
      new Date('2026-05-15T09:00:00Z'),
      new Date('2026-05-15T21:00:00Z'),
    );
    const occ = ctx.occRepoFake.rows[0];
    await ctx.missSvc.fireDeadlineTick(new Date('2026-05-15T21:01:00Z'));
    expect(occ.status).toBe('missed');

    ctx.clock.setNow(new Date('2026-05-15T21:02:00Z'));
    await expect(
      ctx.actionsSvc.lateComplete(occ.id),
    ).rejects.toThrow(/recurring/);
    expect(occ.status).toBe('missed');
  });

  it('updateWindowed cannot enable allow_late_completion (always forced false)', async () => {
    const ctx = build();
    const task = await ctx.tasksSvc.createWindowed({
      name: 'Test Task',
      recurrence: { preset: 'daily' },
      windowStartOffsetMinutes: 60,
      windowEndOffsetMinutes: 120,
      points: 2,
      assigneeIds: [ctx.bob.id],
    });
    const updated = await ctx.tasksSvc.updateWindowed(task.id, {
      name: 'Test Task 2',
    });
    expect(updated.allowLateCompletion).toBe(false);
    expect(updated.lateWindowMinutes).toBe(0);
  });
});
