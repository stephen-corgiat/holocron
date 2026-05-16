import { Repository } from 'typeorm';
import { GoalsService } from './goals.service';
import { GoalEntity } from './goal.entity';
import { GoalCompletionEntity } from './goal-completion.entity';
import { GoalFavoriteEntity } from './goal-favorite.entity';
import { GoalInProgressEntity } from './goal-in-progress.entity';
import { CategoryEntity } from './category.entity';
import { UserEntity } from '../users/user.entity';
import { TransactionEntity } from '../transactions/transaction.entity';
import { TransactionsService } from '../transactions/transactions.service';
import { RealtimeBus } from '../realtime/realtime-bus';
import { CategoriesService } from './categories.service';
import { HouseholdSettingsService } from '../household-settings/household-settings.service';
import { RestrictionEntity } from '../restrictions/restriction.entity';
import { LiftService } from '../restrictions/lift';

jest.mock('typeorm', () => {
  const actual = jest.requireActual('typeorm');
  return {
    ...actual,
    In: (values: string[]) => ({ _value: values }),
    Between: (from: Date, to: Date) => ({ _from: from, _to: to }),
    IsNull: () => null,
  };
});

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

class FakeRepo<T extends { id?: string }> {
  rows: T[] = [];
  private prefix: string;
  private nextId = 1;

  constructor(prefix: string) {
    this.prefix = prefix;
  }
  create(partial: Partial<T>): T {
    return { ...partial } as T;
  }
  async save(entity: T): Promise<T> {
    if (!entity.id) {
      (entity as { id: string }).id = `${this.prefix}-${this.nextId++}`;
      const ent = entity as unknown as { createdAt?: Date; completedAt?: Date };
      if (!ent.createdAt) ent.createdAt = new Date();
      if ('completedAt' in ent && !ent.completedAt) ent.completedAt = new Date();
      this.rows.push(entity);
    } else {
      const idx = this.rows.findIndex((r) => r.id === entity.id);
      if (idx >= 0) this.rows[idx] = entity;
      else this.rows.push(entity);
    }
    return entity;
  }
  async findOne(opts: { where: Partial<T> }): Promise<T | null> {
    return (
      this.rows.find((r) =>
        Object.entries(opts.where).every(
          ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
        ),
      ) ?? null
    );
  }
  async find(opts: { where?: Partial<T>; order?: Record<string, 'ASC' | 'DESC'> } = {}): Promise<T[]> {
    const w = opts.where ?? {};
    let rows = this.rows.filter((r) =>
      Object.entries(w).every(
        ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
      ),
    );
    if (opts.order) {
      const entries = Object.entries(opts.order);
      rows = [...rows].sort((a, b) => {
        for (const [k, dir] of entries) {
          const av = (a as unknown as Record<string, unknown>)[k];
          const bv = (b as unknown as Record<string, unknown>)[k];
          if (av === bv) continue;
          const cmp =
            (av as number | string | Date) < (bv as number | string | Date)
              ? -1
              : 1;
          return dir === 'DESC' ? -cmp : cmp;
        }
        return 0;
      });
    }
    return rows;
  }
  async count(opts: { where?: Partial<T> } = {}): Promise<number> {
    const list = await this.find(opts);
    return list.length;
  }
  async remove(entity: T): Promise<void> {
    this.rows = this.rows.filter((r) => r.id !== entity.id);
  }
  async update(
    criteria: Partial<T>,
    patch: Partial<T>,
  ): Promise<{ affected: number }> {
    let affected = 0;
    for (const r of this.rows) {
      if (
        Object.entries(criteria).every(
          ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
        )
      ) {
        Object.assign(r, patch);
        affected++;
      }
    }
    return { affected };
  }
}

class FakeCompositeRepo<T extends object> {
  rows: T[] = [];
  constructor(private readonly keys: (keyof T)[]) {}

  private val(r: T, k: keyof T): unknown {
    return (r as unknown as Record<string, unknown>)[k as string];
  }
  create(partial: Partial<T>): T {
    return { ...partial } as T;
  }
  async save(entity: T): Promise<T> {
    const idx = this.rows.findIndex((r) =>
      this.keys.every((k) => this.val(r, k) === this.val(entity, k)),
    );
    if (idx >= 0) {
      this.rows[idx] = entity;
    } else {
      const ent = entity as unknown as { createdAt?: Date };
      if ('createdAt' in (entity as object) && !ent.createdAt) {
        ent.createdAt = new Date();
      }
      this.rows.push(entity);
    }
    return entity;
  }
  async findOne(opts: { where: Partial<T> }): Promise<T | null> {
    return (
      this.rows.find((r) =>
        Object.entries(opts.where).every(
          ([k, v]) => this.val(r, k as keyof T) === v,
        ),
      ) ?? null
    );
  }
  async find(
    opts: { where?: Partial<T>; order?: Record<string, 'ASC' | 'DESC'> } = {},
  ): Promise<T[]> {
    const w = opts.where ?? {};
    let rows = this.rows.filter((r) =>
      Object.entries(w).every(([k, v]) => this.val(r, k as keyof T) === v),
    );
    if (opts.order) {
      const entries = Object.entries(opts.order);
      rows = [...rows].sort((a, b) => {
        for (const [k, dir] of entries) {
          const av = this.val(a, k as keyof T);
          const bv = this.val(b, k as keyof T);
          if (av === bv) continue;
          const cmp =
            (av as number | string | Date) < (bv as number | string | Date)
              ? -1
              : 1;
          return dir === 'DESC' ? -cmp : cmp;
        }
        return 0;
      });
    }
    return rows;
  }
  async delete(criteria: Partial<T>): Promise<{ affected: number }> {
    const before = this.rows.length;
    this.rows = this.rows.filter(
      (r) =>
        !Object.entries(criteria).every(
          ([k, v]) => this.val(r, k as keyof T) === v,
        ),
    );
    return { affected: before - this.rows.length };
  }
  async remove(entities: T | T[]): Promise<void> {
    const list = Array.isArray(entities) ? entities : [entities];
    for (const e of list) {
      this.rows = this.rows.filter(
        (r) => !this.keys.every((k) => this.val(r, k) === this.val(e, k)),
      );
    }
  }
}

class FakeUserRepo {
  constructor(private readonly users: UserEntity[]) {}
  async findOne(opts: { where: { id: string; deactivatedAt: unknown } }): Promise<UserEntity | null> {
    return (
      this.users.find(
        (u) => u.id === opts.where.id && u.deactivatedAt === null,
      ) ?? null
    );
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
  createQueryBuilder() {
    return {
      select() {
        return this;
      },
      where() {
        return this;
      },
      async getRawOne() {
        return { sum: 0 };
      },
    };
  }
}

function setup() {
  const alice = makeUser({ id: 'u-alice', displayName: 'Alice', isAdmin: true });
  const bob = makeUser({ id: 'u-bob', displayName: 'Bob' });
  const carol = makeUser({ id: 'u-carol', displayName: 'Carol' });
  const goalsRepo = new FakeRepo<GoalEntity>('g');
  const completionsRepo = new FakeRepo<GoalCompletionEntity>('gc');
  const favoritesRepo = new FakeCompositeRepo<GoalFavoriteEntity>([
    'userId',
    'goalId',
  ]);
  const inProgressRepo = new FakeCompositeRepo<GoalInProgressEntity>([
    'userId',
    'goalId',
  ]);
  const categoriesRepo = new FakeRepo<CategoryEntity>('c');
  const usersRepo = new FakeUserRepo([alice, bob, carol]);
  const txnRepo = new FakeTransactionRepo();
  const txnSvc = new TransactionsService(txnRepo as unknown as Repository<TransactionEntity>);
  const bus = new RealtimeBus();
  const settings = {
    timeZone: async () => 'America/Los_Angeles',
  } as unknown as HouseholdSettingsService;
  const restrictionRepo = new FakeRepo<RestrictionEntity>('r');
  const liftStub = {
    applyLift: async () => ({
      touchedRestrictionIds: [],
      liftedRestrictionIds: [],
    }),
  } as unknown as LiftService;
  const goalsSvc = new GoalsService(
    goalsRepo as unknown as Repository<GoalEntity>,
    completionsRepo as unknown as Repository<GoalCompletionEntity>,
    favoritesRepo as unknown as Repository<GoalFavoriteEntity>,
    inProgressRepo as unknown as Repository<GoalInProgressEntity>,
    categoriesRepo as unknown as Repository<CategoryEntity>,
    usersRepo as unknown as Repository<UserEntity>,
    restrictionRepo as unknown as Repository<RestrictionEntity>,
    txnSvc,
    bus,
    settings,
    liftStub,
    { now: () => new Date() },
  );
  const categoriesSvc = new CategoriesService(
    categoriesRepo as unknown as Repository<CategoryEntity>,
    goalsRepo as unknown as Repository<GoalEntity>,
  );
  return {
    alice,
    bob,
    carol,
    goalsSvc,
    categoriesSvc,
    txnRepo,
    completionsRepo,
    goalsRepo,
    categoriesRepo,
    restrictionRepo,
    liftStub,
    favoritesRepo,
    inProgressRepo,
    bus,
  };
}

describe('GoalsService.complete', () => {
  it('records a completion, posts an earn transaction tagged with the goal_completion_id', async () => {
    const { goalsSvc, categoriesSvc, bob, txnRepo, completionsRepo } = setup();
    const cat = await categoriesSvc.create({ name: 'Chores' });
    const goal = await goalsSvc.create({
      name: 'Test Goal',
      categoryId: cat.id,
      points: 5,
      completionLimit: 3,
      limitWindow: 'day',
    });
    const { completion, amount } = await goalsSvc.complete(
      goal.id,
      bob.id,
      new Date('2026-05-15T18:00:00Z'),
    );
    expect(amount).toBe(5);
    expect(completionsRepo.rows).toHaveLength(1);
    expect(txnRepo.rows).toHaveLength(1);
    expect(txnRepo.rows[0]).toMatchObject({
      userId: bob.id,
      kind: 'earn',
      amount: 5,
      reason: 'goal: Test Goal',
      goalCompletionId: completion.id,
    });
  });

  it('enforces the per-window completion_limit', async () => {
    const { goalsSvc, categoriesSvc, bob } = setup();
    const cat = await categoriesSvc.create({ name: 'Chores' });
    const goal = await goalsSvc.create({
      name: 'Test Goal',
      categoryId: cat.id,
      points: 2,
      completionLimit: 2,
      limitWindow: 'day',
    });
    const day = new Date('2026-05-15T18:00:00Z');
    await goalsSvc.complete(goal.id, bob.id, day);
    await goalsSvc.complete(goal.id, bob.id, day);
    await expect(goalsSvc.complete(goal.id, bob.id, day)).rejects.toThrow(
      /maxed out/,
    );
  });

  it('refuses to complete a goal assigned to a different Trackee', async () => {
    const { goalsSvc, categoriesSvc, bob, carol } = setup();
    const cat = await categoriesSvc.create({ name: 'Chores' });
    const goal = await goalsSvc.create({
      name: 'Test Goal',
      categoryId: cat.id,
      points: 1,
      completionLimit: 1,
      limitWindow: 'lifetime',
      assignedToUserId: carol.id,
    });
    await expect(
      goalsSvc.complete(goal.id, bob.id, new Date()),
    ).rejects.toThrow(/different Trackee/);
  });
});

describe('GoalsService.completeAsRemediation', () => {
  it('posts a normal earn, tags the completion with the restriction_id, and lifts the restriction', async () => {
    const {
      goalsSvc,
      categoriesSvc,
      bob,
      txnRepo,
      completionsRepo,
      restrictionRepo,
      liftStub,
    } = setup();
    const cat = await categoriesSvc.create({ name: 'Chores' });
    const goal = await goalsSvc.create({
      name: 'Test Goal',
      categoryId: cat.id,
      points: 5,
      completionLimit: 3,
      limitWindow: 'day',
      usableAsRemediation: true,
    });
    const restriction = await restrictionRepo.save({
      userId: bob.id,
      scope: 'internet',
      effectiveExpiresAt: null,
      effectiveRemediationGoals: [goal.id],
      liftedAt: null,
    } as unknown as RestrictionEntity);
    const liftSpy = jest.spyOn(liftStub, 'applyLift');

    const { completion, amount } = await goalsSvc.completeAsRemediation(
      goal.id,
      bob.id,
      restriction.id!,
      new Date('2026-05-15T18:00:00Z'),
    );

    expect(amount).toBe(5);
    expect(txnRepo.rows).toHaveLength(1);
    expect(txnRepo.rows[0].kind).toBe('earn');
    expect(completionsRepo.rows).toHaveLength(1);
    expect(completion.remediationForRestrictionId).toBe(restriction.id);
    expect(liftSpy).toHaveBeenCalledWith({
      mechanism: 'goal_remediation',
      filter: { kind: 'all_for_restriction', restrictionId: restriction.id },
    });
  });

  it('rejects when the goal is not in the restriction\'s effective_remediation_goals', async () => {
    const { goalsSvc, categoriesSvc, bob, restrictionRepo } = setup();
    const cat = await categoriesSvc.create({ name: 'Chores' });
    const goal = await goalsSvc.create({
      name: 'Test Goal',
      categoryId: cat.id,
      points: 5,
      completionLimit: 3,
      limitWindow: 'day',
    });
    const restriction = await restrictionRepo.save({
      userId: bob.id,
      scope: 'internet',
      effectiveExpiresAt: null,
      effectiveRemediationGoals: [],
      liftedAt: null,
    } as unknown as RestrictionEntity);

    await expect(
      goalsSvc.completeAsRemediation(
        goal.id,
        bob.id,
        restriction.id!,
        new Date(),
      ),
    ).rejects.toThrow(/not an effective remediation/);
  });

  it('rejects when the restriction is already lifted', async () => {
    const { goalsSvc, categoriesSvc, bob, restrictionRepo } = setup();
    const cat = await categoriesSvc.create({ name: 'Chores' });
    const goal = await goalsSvc.create({
      name: 'Test Goal',
      categoryId: cat.id,
      points: 5,
      completionLimit: 3,
      limitWindow: 'day',
    });
    const restriction = await restrictionRepo.save({
      userId: bob.id,
      scope: 'internet',
      effectiveExpiresAt: null,
      effectiveRemediationGoals: [goal.id],
      liftedAt: new Date(),
    } as unknown as RestrictionEntity);

    await expect(
      goalsSvc.completeAsRemediation(
        goal.id,
        bob.id,
        restriction.id!,
        new Date(),
      ),
    ).rejects.toThrow(/not active/);
  });
});

describe('GoalsService.catalogFor', () => {
  it('hides goals assigned to a different Trackee and reports remaining', async () => {
    const { goalsSvc, categoriesSvc, bob, carol } = setup();
    const cat = await categoriesSvc.create({ name: 'Chores' });
    const sharedGoal = await goalsSvc.create({
      name: 'Test Goal 1',
      categoryId: cat.id,
      points: 1,
      completionLimit: 2,
      limitWindow: 'week',
    });
    const carolOnly = await goalsSvc.create({
      name: 'Test Goal 2',
      categoryId: cat.id,
      points: 1,
      completionLimit: 1,
      limitWindow: 'week',
      assignedToUserId: carol.id,
    });
    await goalsSvc.complete(sharedGoal.id, bob.id, new Date('2026-05-13T18:00:00Z'));

    const bobCatalog = await goalsSvc.catalogFor(bob.id, new Date('2026-05-15T18:00:00Z'));
    expect(bobCatalog.map((c) => c.goal.id)).toEqual([sharedGoal.id]);
    expect(bobCatalog[0].remaining).toBe(1);
    expect(bobCatalog[0].maxedOut).toBe(false);

    const carolCatalog = await goalsSvc.catalogFor(carol.id, new Date('2026-05-15T18:00:00Z'));
    expect(carolCatalog.map((c) => c.goal.id).sort()).toEqual(
      [sharedGoal.id, carolOnly.id].sort(),
    );
  });

  it('flags a maxed-out goal so the tablet can render it disabled', async () => {
    const { goalsSvc, categoriesSvc, bob } = setup();
    const cat = await categoriesSvc.create({ name: 'Chores' });
    const goal = await goalsSvc.create({
      name: 'Test Goal',
      categoryId: cat.id,
      points: 5,
      completionLimit: 1,
      limitWindow: 'week',
    });
    await goalsSvc.complete(goal.id, bob.id, new Date('2026-05-15T18:00:00Z'));
    const catalog = await goalsSvc.catalogFor(bob.id, new Date('2026-05-15T18:00:00Z'));
    expect(catalog[0].maxedOut).toBe(true);
    expect(catalog[0].remaining).toBe(0);
  });

  it('omits inactive and hidden goals', async () => {
    const { goalsSvc, categoriesSvc, bob } = setup();
    const cat = await categoriesSvc.create({ name: 'Chores' });
    await goalsSvc.create({
      name: 'Test Goal 1',
      categoryId: cat.id,
      points: 1,
      completionLimit: 1,
      limitWindow: 'day',
      active: false,
    });
    await goalsSvc.create({
      name: 'Test Goal 2',
      categoryId: cat.id,
      points: 1,
      completionLimit: 1,
      limitWindow: 'day',
      showInCatalog: false,
    });
    const catalog = await goalsSvc.catalogFor(bob.id, new Date());
    expect(catalog).toHaveLength(0);
  });
});

describe('GoalsService — tiered', () => {
  it('records the picked tier_value on the completion and earn transaction', async () => {
    const { goalsSvc, categoriesSvc, bob, txnRepo, completionsRepo } = setup();
    const cat = await categoriesSvc.create({ name: 'Creative' });
    const goal = await goalsSvc.create({
      name: 'Test Goal',
      categoryId: cat.id,
      kind: 'tiered',
      tierValues: [10, 20, 30, 40, 50],
      completionLimit: 1,
      limitWindow: 'week',
    });
    expect(goal.points).toBe(0);
    expect(goal.tierValues).toEqual([10, 20, 30, 40, 50]);

    const { completion, amount } = await goalsSvc.complete(
      goal.id,
      bob.id,
      new Date('2026-05-15T18:00:00Z'),
      30,
    );
    expect(amount).toBe(30);
    expect(completionsRepo.rows[0].tierValue).toBe(30);
    expect(txnRepo.rows[0]).toMatchObject({
      amount: 30,
      reason: 'goal: Test Goal',
      goalCompletionId: completion.id,
    });
  });

  it('rejects a tier_value not in the goal’s list', async () => {
    const { goalsSvc, categoriesSvc, bob } = setup();
    const cat = await categoriesSvc.create({ name: 'Creative' });
    const goal = await goalsSvc.create({
      name: 'Test Goal',
      categoryId: cat.id,
      kind: 'tiered',
      tierValues: [10, 20, 30],
      completionLimit: 5,
      limitWindow: 'week',
    });
    await expect(
      goalsSvc.complete(goal.id, bob.id, new Date('2026-05-15T18:00:00Z'), 25),
    ).rejects.toThrow(/tier_value 25/);
  });

  it('requires tier_value for tiered goals', async () => {
    const { goalsSvc, categoriesSvc, bob } = setup();
    const cat = await categoriesSvc.create({ name: 'Creative' });
    const goal = await goalsSvc.create({
      name: 'Test Goal',
      categoryId: cat.id,
      kind: 'tiered',
      tierValues: [10, 20, 30],
      completionLimit: 5,
      limitWindow: 'week',
    });
    await expect(
      goalsSvc.complete(goal.id, bob.id, new Date('2026-05-15T18:00:00Z')),
    ).rejects.toThrow(/tier_value required/);
  });

  it('enforces completion_limit identically to flat regardless of tier picks', async () => {
    const { goalsSvc, categoriesSvc, bob } = setup();
    const cat = await categoriesSvc.create({ name: 'Creative' });
    const goal = await goalsSvc.create({
      name: 'Test Goal',
      categoryId: cat.id,
      kind: 'tiered',
      tierValues: [10, 20, 30, 40, 50],
      completionLimit: 3,
      limitWindow: 'week',
    });
    const at = (d: string) => new Date(d);
    await goalsSvc.complete(goal.id, bob.id, at('2026-05-12T15:00:00Z'), 10);
    await goalsSvc.complete(goal.id, bob.id, at('2026-05-13T15:00:00Z'), 50);
    await goalsSvc.complete(goal.id, bob.id, at('2026-05-14T15:00:00Z'), 20);
    await expect(
      goalsSvc.complete(goal.id, bob.id, at('2026-05-15T15:00:00Z'), 10),
    ).rejects.toThrow(/maxed out/);
  });

  it('refuses to create a tiered goal with no tier_values', async () => {
    const { goalsSvc, categoriesSvc } = setup();
    const cat = await categoriesSvc.create({ name: 'Creative' });
    await expect(
      goalsSvc.create({
        name: 'Test Goal',
        categoryId: cat.id,
        kind: 'tiered',
        tierValues: [],
        completionLimit: 1,
        limitWindow: 'week',
      }),
    ).rejects.toThrow(/at least one tier_value/);
  });

  it('save/load roundtrip preserves kind and tier_values on update', async () => {
    const { goalsSvc, categoriesSvc } = setup();
    const cat = await categoriesSvc.create({ name: 'Creative' });
    const goal = await goalsSvc.create({
      name: 'Test Goal',
      categoryId: cat.id,
      points: 5,
      completionLimit: 1,
      limitWindow: 'week',
    });
    const updated = await goalsSvc.update(goal.id, {
      kind: 'tiered',
      tierValues: [5, 15, 25],
    });
    expect(updated.kind).toBe('tiered');
    expect(updated.tierValues).toEqual([5, 15, 25]);
    expect(updated.points).toBe(0);

    const flipped = await goalsSvc.update(goal.id, {
      kind: 'flat',
      points: 7,
    });
    expect(flipped.kind).toBe('flat');
    expect(flipped.points).toBe(7);
    expect(flipped.tierValues).toEqual([]);
  });
});

describe('GoalsService — favorites', () => {
  it('starring is idempotent: calling setFavorite(true) twice keeps one row', async () => {
    const { goalsSvc, categoriesSvc, bob, favoritesRepo } = setup();
    const cat = await categoriesSvc.create({ name: 'Chores' });
    const goal = await goalsSvc.create({
      name: 'Test Goal',
      categoryId: cat.id,
      points: 1,
      completionLimit: 1,
      limitWindow: 'day',
    });
    await goalsSvc.setFavorite(bob.id, goal.id, true);
    await goalsSvc.setFavorite(bob.id, goal.id, true);
    expect(favoritesRepo.rows).toHaveLength(1);
    expect(await goalsSvc.listFavorites(bob.id)).toEqual([goal.id]);
  });

  it('unstarring removes the row and is a no-op if not starred', async () => {
    const { goalsSvc, categoriesSvc, bob, favoritesRepo } = setup();
    const cat = await categoriesSvc.create({ name: 'Chores' });
    const goal = await goalsSvc.create({
      name: 'Test Goal',
      categoryId: cat.id,
      points: 1,
      completionLimit: 1,
      limitWindow: 'day',
    });
    await goalsSvc.setFavorite(bob.id, goal.id, false);
    expect(favoritesRepo.rows).toHaveLength(0);
    await goalsSvc.setFavorite(bob.id, goal.id, true);
    await goalsSvc.setFavorite(bob.id, goal.id, false);
    expect(favoritesRepo.rows).toHaveLength(0);
  });

  it('favorites are scoped per-user', async () => {
    const { goalsSvc, categoriesSvc, bob, carol } = setup();
    const cat = await categoriesSvc.create({ name: 'Chores' });
    const goal = await goalsSvc.create({
      name: 'Test Goal',
      categoryId: cat.id,
      points: 1,
      completionLimit: 1,
      limitWindow: 'day',
    });
    await goalsSvc.setFavorite(bob.id, goal.id, true);
    expect(await goalsSvc.listFavorites(bob.id)).toEqual([goal.id]);
    expect(await goalsSvc.listFavorites(carol.id)).toEqual([]);
  });
});

describe('GoalsService — in-progress', () => {
  it('marking the same goal in-progress twice is a no-op (no duplicate, startedAt preserved)', async () => {
    const { goalsSvc, categoriesSvc, bob, inProgressRepo } = setup();
    const cat = await categoriesSvc.create({ name: 'Chores' });
    const goal = await goalsSvc.create({
      name: 'Test Goal',
      categoryId: cat.id,
      points: 1,
      completionLimit: 1,
      limitWindow: 'day',
    });
    const t1 = new Date('2026-05-10T10:00:00Z');
    const t2 = new Date('2026-05-11T10:00:00Z');
    await goalsSvc.addInProgress(bob.id, goal.id, t1);
    await goalsSvc.addInProgress(bob.id, goal.id, t2);
    expect(inProgressRepo.rows).toHaveLength(1);
    expect(inProgressRepo.rows[0].startedAt).toEqual(t1);
  });

  it('soft-caps at 4 by auto-evicting the oldest', async () => {
    const { goalsSvc, categoriesSvc, bob, inProgressRepo } = setup();
    const cat = await categoriesSvc.create({ name: 'Chores' });
    const goals = await Promise.all(
      ['A', 'B', 'C', 'D', 'E'].map((name) =>
        goalsSvc.create({
          name: `Test Goal ${name}`,
          categoryId: cat.id,
          points: 1,
          completionLimit: 5,
          limitWindow: 'day',
        }),
      ),
    );
    const at = (d: string) => new Date(d);
    await goalsSvc.addInProgress(bob.id, goals[0].id, at('2026-05-10T10:00:00Z'));
    await goalsSvc.addInProgress(bob.id, goals[1].id, at('2026-05-11T10:00:00Z'));
    await goalsSvc.addInProgress(bob.id, goals[2].id, at('2026-05-12T10:00:00Z'));
    await goalsSvc.addInProgress(bob.id, goals[3].id, at('2026-05-13T10:00:00Z'));
    await goalsSvc.addInProgress(bob.id, goals[4].id, at('2026-05-13T10:00:00Z'));

    expect(inProgressRepo.rows).toHaveLength(4);
    const ids = (await goalsSvc.listInProgress(bob.id)).map((r) => r.goalId);
    expect(ids).toEqual([goals[1].id, goals[2].id, goals[3].id, goals[4].id]);
  });

  it('removeInProgress clears the row; complete() also auto-clears', async () => {
    const { goalsSvc, categoriesSvc, bob, inProgressRepo } = setup();
    const cat = await categoriesSvc.create({ name: 'Chores' });
    const goal = await goalsSvc.create({
      name: 'Test Goal',
      categoryId: cat.id,
      points: 3,
      completionLimit: 2,
      limitWindow: 'day',
    });
    await goalsSvc.addInProgress(bob.id, goal.id);
    expect(inProgressRepo.rows).toHaveLength(1);
    await goalsSvc.removeInProgress(bob.id, goal.id);
    expect(inProgressRepo.rows).toHaveLength(0);

    await goalsSvc.addInProgress(bob.id, goal.id);
    await goalsSvc.complete(goal.id, bob.id);
    expect(inProgressRepo.rows).toHaveLength(0);
  });
});

describe('GoalsService — recentCompletions', () => {
  it('returns the most-recent distinct goals, newest first, capped at limit', async () => {
    const { goalsSvc, categoriesSvc, bob } = setup();
    const cat = await categoriesSvc.create({ name: 'Chores' });
    const a = await goalsSvc.create({
      name: 'Test Goal A',
      categoryId: cat.id,
      points: 1,
      completionLimit: 5,
      limitWindow: 'week',
    });
    const b = await goalsSvc.create({
      name: 'Test Goal B',
      categoryId: cat.id,
      points: 1,
      completionLimit: 5,
      limitWindow: 'week',
    });
    const c = await goalsSvc.create({
      name: 'Test Goal C',
      categoryId: cat.id,
      points: 1,
      completionLimit: 5,
      limitWindow: 'week',
    });
    const d = await goalsSvc.create({
      name: 'Test Goal D',
      categoryId: cat.id,
      points: 1,
      completionLimit: 5,
      limitWindow: 'week',
    });
    const at = (s: string) => new Date(s);
    await goalsSvc.complete(a.id, bob.id, at('2026-05-12T10:00:00Z'));
    await goalsSvc.complete(a.id, bob.id, at('2026-05-13T10:00:00Z')); // a dup
    await goalsSvc.complete(b.id, bob.id, at('2026-05-14T10:00:00Z'));
    await goalsSvc.complete(c.id, bob.id, at('2026-05-15T10:00:00Z'));
    await goalsSvc.complete(d.id, bob.id, at('2026-05-16T10:00:00Z'));

    const top3 = await goalsSvc.recentCompletions(bob.id, 3);
    expect(top3.map((r) => r.goalId)).toEqual([d.id, c.id, b.id]);
  });
});

describe('CategoriesService', () => {
  it('refuses to delete a category that still has goals', async () => {
    const { categoriesSvc, goalsSvc } = setup();
    const cat = await categoriesSvc.create({ name: 'Chores' });
    await goalsSvc.create({
      name: 'Test Goal',
      categoryId: cat.id,
      points: 1,
      completionLimit: 1,
      limitWindow: 'day',
    });
    await expect(categoriesSvc.remove(cat.id)).rejects.toThrow(/still has/);
  });

  it('rename preserves the link: goals keep referencing the same id', async () => {
    const { categoriesSvc, goalsSvc } = setup();
    const cat = await categoriesSvc.create({ name: 'Chores' });
    const goal = await goalsSvc.create({
      name: 'Test Goal',
      categoryId: cat.id,
      points: 1,
      completionLimit: 1,
      limitWindow: 'day',
    });
    await categoriesSvc.update(cat.id, { name: 'Outdoor' });
    const refreshed = await goalsSvc.findById(goal.id);
    expect(refreshed.categoryId).toBe(cat.id);
  });
});
