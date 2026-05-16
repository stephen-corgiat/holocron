import { Repository, DataSource } from 'typeorm';
import { PendingReviewService } from './pending-review.service';
import { OccurrenceEntity } from '../tasks/occurrence.entity';
import { TaskEntity } from '../tasks/task.entity';
import { TransactionEntity } from '../transactions/transaction.entity';
import { LadderPositionEntity } from '../tasks/ladder-position.entity';
import { UserEntity } from '../users/user.entity';
import { MissService } from '../tasks/miss.service';
import { RealtimeBus } from '../realtime/realtime-bus';
import { HouseholdSettingsService } from '../household-settings/household-settings.service';
import { HouseholdSettingsEntity } from '../household-settings/household-settings.entity';
import { OccurrencesService } from '../tasks/occurrences.service';
import { TasksService } from '../tasks/tasks.service';
import { TransactionsService } from '../transactions/transactions.service';
import { ResolutionService } from '../tasks/resolution';
import { DailyStreakEntity } from '../tasks/daily-streak.entity';

// Replicate just enough of typeorm operators that the fake repos need to
// inspect.
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
  async find(opts: {
    where: { id: { _value: string[] }; deactivatedAt: unknown };
  }): Promise<UserEntity[]> {
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
    where: Partial<OccurrenceEntity> & { pendingSince?: { _lt: Date }; scheduledAt?: { _lte: Date } };
    relations?: Record<string, unknown>;
    order?: Record<string, unknown>;
  }): Promise<OccurrenceEntity[]> {
    const w = opts.where ?? {};
    const matches = this.rows.filter((r) => {
      for (const [k, v] of Object.entries(w)) {
        if (k === 'pendingSince') {
          const ps = r.pendingSince;
          if (!ps || ps >= (v as { _lt: Date })._lt) return false;
          continue;
        }
        if (k === 'scheduledAt') {
          if (r.scheduledAt > (v as { _lte: Date })._lte) return false;
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
    where: { id?: string; taskId?: string; userId?: string };
    relations?: Record<string, unknown>;
  }): Promise<OccurrenceEntity | null> {
    const m =
      opts.where.id !== undefined
        ? this.rows.find((r) => r.id === opts.where.id)
        : this.rows.find(
            (r) =>
              r.taskId === opts.where.taskId &&
              r.userId === opts.where.userId,
          );
    if (!m) return null;
    if (opts.relations?.task) m.task = this.taskLookup(m.taskId) as TaskEntity;
    if (opts.relations?.user) m.user = this.userLookup(m.userId) as UserEntity;
    return m;
  }
  // Minimal query-builder stub used by MissService.fireDeadlineTick. The
  // real implementation filters by (status='active') and deadline<=now;
  // here we mirror that against the in-memory rows and hydrate the task/user
  // relations so the engine sees them. Window_end is honored as the deadline
  // when set.
  createQueryBuilder(_alias: string) {
    const taskLookup = this.taskLookup;
    const userLookup = this.userLookup;
    const params: Record<string, unknown> = {};
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
        Object.assign(params, p ?? {});
        if (p && 'now' in p) nowFilter = p['now'] as Date;
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

function fakeDataSource(
  occRepo: FakeOccurrenceRepo,
  txnRepo: FakeTransactionRepo,
  ladderRepo: FakeLadderPositionRepo,
): DataSource {
  return {
    async transaction(work: (mgr: unknown) => Promise<void>): Promise<void> {
      const mgr = {
        getRepository(target: { name?: string }) {
          // Nest passes the entity constructor; in jest the name is preserved.
          if (target === OccurrenceEntity) return occRepo;
          if (target === TransactionEntity) return txnRepo;
          if (target === LadderPositionEntity) return ladderRepo;
          throw new Error(`unknown repository ${target.name ?? 'anon'}`);
        },
      };
      await work(mgr);
    },
  } as unknown as DataSource;
}

class FakeSettingsRepo {
  row: { id: 1; pendingReviewTimeout: string; updatedAt: Date } | null = {
    id: 1,
    pendingReviewTimeout: '48 hours',
    updatedAt: new Date(),
  };
  create(p: { id?: number }) {
    return { id: 1, pendingReviewTimeout: '48 hours', updatedAt: new Date() };
  }
  async findOne(): Promise<unknown> {
    return this.row;
  }
  async save<T>(r: T): Promise<T> {
    this.row = r as never;
    return r;
  }
}

function build(opts: { requiresVerification: boolean }) {
  const alice = makeUser({ id: 'u-alice', displayName: 'Alice', isAdmin: true, isRestrictable: false });
  const bob = makeUser({ id: 'u-bob', displayName: 'Bob', isRestrictable: true });
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
  const settingsRepoFake = new FakeSettingsRepo();
  const settingsRepo = settingsRepoFake as unknown as Repository<HouseholdSettingsEntity>;

  const bus = new RealtimeBus();
  const tasksSvc = new TasksService(tasksRepo, userRepo);
  const txnSvc = new TransactionsService(txnRepo);
  const dataSource = fakeDataSource(occRepoFake, txnRepoFake, ladderRepoFake);
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
  const streakRepo = {
    findOne: async () => null,
    save: async (x: unknown) => x,
  } as unknown as Repository<DailyStreakEntity>;
  const clock = { now: () => new Date() };
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
  );
  const settingsSvc = new HouseholdSettingsService(settingsRepo);
  const pendingSvc = new PendingReviewService(
    occRepo,
    userRepo,
    resolutionSvc,
    settingsSvc,
    clock,
  );

  return {
    alice,
    bob,
    tasksSvc,
    occSvc,
    pendingSvc,
    missSvc,
    settingsSvc,
    tasksRepoFake,
    occRepoFake,
    txnRepoFake,
    ladderRepoFake,
    settingsRepoFake,
    requiresVerification: opts.requiresVerification,
  };
}

async function setupRecurringTask(
  ctx: ReturnType<typeof build>,
  options: { requiresVerification: boolean; ladder?: Array<{ points: number }> } = { requiresVerification: false },
) {
  const task = await ctx.tasksSvc.createRecurring({
    name: 'Test Task',
    dueTime: '08:00',
    recurrence: { preset: 'daily' },
    points: 7,
    requiresVerification: options.requiresVerification,
    ladder: options.ladder?.map((t) => ({ points: t.points, restriction: null })) ?? [
      { points: 3, restriction: null },
    ],
    assigneeIds: [ctx.bob.id],
  });
  await ctx.occSvc.generateForDate(new Date('2026-05-14T05:00:00'));
  const occ = ctx.occRepoFake.rows[0];
  return { task, occ };
}

describe('OccurrencesService.markComplete — verifiable path (ADR-0002)', () => {
  it('transitions to pending_review and posts optimistic earn for requires_verification tasks', async () => {
    const ctx = build({ requiresVerification: true });
    const { occ } = await setupRecurringTask(ctx, { requiresVerification: true });

    await ctx.occSvc.markComplete(occ.id);

    expect(occ.status).toBe('pending_review');
    expect(occ.pendingSince).toBeInstanceOf(Date);
    expect(ctx.txnRepoFake.rows).toHaveLength(1);
    expect(ctx.txnRepoFake.rows[0]).toMatchObject({
      userId: ctx.bob.id,
      kind: 'earn',
      amount: 7,
    });
  });

  it('non-verifiable tasks still transition straight to complete', async () => {
    const ctx = build({ requiresVerification: false });
    const { occ } = await setupRecurringTask(ctx, { requiresVerification: false });
    await ctx.occSvc.markComplete(occ.id);
    expect(occ.status).toBe('complete');
    expect(occ.pendingSince ?? null).toBeNull();
  });
});

describe('MissService.fireDeadlineTick — pending_review suppression', () => {
  it('does NOT fire a Miss for a pending_review occurrence even past due_time', async () => {
    const ctx = build({ requiresVerification: true });
    const { occ } = await setupRecurringTask(ctx, { requiresVerification: true });

    await ctx.occSvc.markComplete(occ.id);
    // Crank time forward past the deadline.
    const wayPastDue = new Date(occ.scheduledAt.getTime() + 24 * 3600_000);
    const result = await ctx.missSvc.fireDeadlineTick(wayPastDue);

    expect(result.fired).toBe(0);
    expect(occ.status).toBe('pending_review');
    // No penalty transactions; only the optimistic earn remains.
    expect(ctx.txnRepoFake.rows.filter((t) => t.kind === 'penalty')).toHaveLength(0);
  });
});

describe('PendingReviewService.approve', () => {
  it('transitions to complete with no extra ledger action', async () => {
    const ctx = build({ requiresVerification: true });
    const { occ } = await setupRecurringTask(ctx, { requiresVerification: true });
    await ctx.occSvc.markComplete(occ.id);
    expect(ctx.txnRepoFake.rows).toHaveLength(1); // earn

    await ctx.pendingSvc.approve(occ.id, ctx.alice.id);

    expect(occ.status).toBe('complete');
    expect(occ.pendingSince).toBeNull();
    // Still only the original earn — no extra ledger entries on approval.
    expect(ctx.txnRepoFake.rows).toHaveLength(1);
  });
});

describe('PendingReviewService.reject', () => {
  it('claws back the optimistic earn and fires the Miss with shared txn_group_id', async () => {
    const ctx = build({ requiresVerification: true });
    const { occ } = await setupRecurringTask(ctx, {
      requiresVerification: true,
      ladder: [{ points: 3 }, { points: 5 }],
    });
    await ctx.occSvc.markComplete(occ.id);

    await ctx.pendingSvc.reject(occ.id, ctx.alice.id);

    expect(occ.status).toBe('missed');
    const clawback = ctx.txnRepoFake.rows.find((t) => t.kind === 'claw_back');
    const penalty = ctx.txnRepoFake.rows.find((t) => t.kind === 'penalty');
    expect(clawback).toBeDefined();
    expect(penalty).toBeDefined();
    expect(clawback!.amount).toBe(-7);
    expect(penalty!.amount).toBe(-3);
    // Both transactions in the same ledger grouping.
    expect(clawback!.txnGroupId).toBeTruthy();
    expect(clawback!.txnGroupId).toEqual(penalty!.txnGroupId);
    // Ladder advanced.
    expect(ctx.ladderRepoFake.rows).toHaveLength(1);
    expect(ctx.ladderRepoFake.rows[0].position).toBe(2);
  });

  it('auto-reject via sweep produces identical effects (same txn_group_id pattern)', async () => {
    const ctx = build({ requiresVerification: true });
    const { occ } = await setupRecurringTask(ctx, { requiresVerification: true });
    await ctx.occSvc.markComplete(occ.id);
    // Backdate pending_since past the 48h default timeout.
    occ.pendingSince = new Date(Date.now() - 49 * 3600_000);

    const { rejected } = await ctx.pendingSvc.sweep(new Date());
    expect(rejected).toBe(1);
    expect(occ.status).toBe('missed');

    const clawback = ctx.txnRepoFake.rows.find((t) => t.kind === 'claw_back');
    const penalty = ctx.txnRepoFake.rows.find((t) => t.kind === 'penalty');
    expect(clawback).toBeDefined();
    expect(penalty).toBeDefined();
    expect(clawback!.adminUserId).toBeNull();
    expect(clawback!.txnGroupId).toEqual(penalty!.txnGroupId);
  });

  it('sweep does NOT auto-reject a pending occurrence that is still within timeout', async () => {
    const ctx = build({ requiresVerification: true });
    const { occ } = await setupRecurringTask(ctx, { requiresVerification: true });
    await ctx.occSvc.markComplete(occ.id);
    // pendingSince is `now` — well within 48h.

    const { rejected } = await ctx.pendingSvc.sweep(new Date());
    expect(rejected).toBe(0);
    expect(occ.status).toBe('pending_review');
  });
});

describe('HouseholdSettingsService', () => {
  it('returns the default 48h timeout for an uninitialised settings table', async () => {
    const ctx = build({ requiresVerification: false });
    const view = await ctx.settingsSvc.view();
    expect(view.pending_review_timeout_hours).toBe(48);
  });

  it('updates the timeout', async () => {
    const ctx = build({ requiresVerification: false });
    const view = await ctx.settingsSvc.updateTimeoutHours(24);
    expect(view.pending_review_timeout_hours).toBe(24);
    const ms = await ctx.settingsSvc.pendingReviewTimeoutMs();
    expect(ms).toBe(24 * 3600_000);
  });
});
