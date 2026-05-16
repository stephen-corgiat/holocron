import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { CLOCK, Clock } from '../clock/clock';
import { GoalEntity, GoalKind, LimitWindow } from './goal.entity';
import { GoalCompletionEntity } from './goal-completion.entity';
import { GoalFavoriteEntity } from './goal-favorite.entity';
import { GoalInProgressEntity } from './goal-in-progress.entity';
import { CategoryEntity } from './category.entity';
import { UserEntity } from '../users/user.entity';
import { TransactionsService } from '../transactions/transactions.service';
import { HouseholdSettingsService } from '../household-settings/household-settings.service';
import { RealtimeBus } from '../realtime/realtime-bus';
import { canComplete, remainingInWindow } from './goal-limit-engine';
import { LiftService } from '../restrictions/lift';
import { RestrictionEntity } from '../restrictions/restriction.entity';

export interface CreateGoalInput {
  name: string;
  icon?: string | null;
  note?: string | null;
  categoryId: string;
  kind?: GoalKind;
  points?: number;
  tierValues?: number[];
  completionLimit: number;
  limitWindow: LimitWindow;
  showInCatalog?: boolean;
  usableAsRemediation?: boolean;
  assignedToUserId?: string | null;
  active?: boolean;
  celebrationVariantId?: string | null;
}

export interface UpdateGoalInput {
  name?: string;
  icon?: string | null;
  note?: string | null;
  categoryId?: string;
  kind?: GoalKind;
  points?: number;
  tierValues?: number[];
  completionLimit?: number;
  limitWindow?: LimitWindow;
  showInCatalog?: boolean;
  usableAsRemediation?: boolean;
  assignedToUserId?: string | null;
  active?: boolean;
  celebrationVariantId?: string | null;
}

export interface CatalogGoal {
  goal: GoalEntity;
  remaining: number;
  maxedOut: boolean;
}

export interface InProgressItem {
  goalId: string;
  startedAt: Date;
}

export const IN_PROGRESS_CAP = 4;

@Injectable()
export class GoalsService {
  constructor(
    @InjectRepository(GoalEntity)
    private readonly goals: Repository<GoalEntity>,
    @InjectRepository(GoalCompletionEntity)
    private readonly completions: Repository<GoalCompletionEntity>,
    @InjectRepository(GoalFavoriteEntity)
    private readonly favorites: Repository<GoalFavoriteEntity>,
    @InjectRepository(GoalInProgressEntity)
    private readonly inProgress: Repository<GoalInProgressEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categories: Repository<CategoryEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(RestrictionEntity)
    private readonly restrictionRepo: Repository<RestrictionEntity>,
    private readonly txns: TransactionsService,
    private readonly bus: RealtimeBus,
    private readonly settings: HouseholdSettingsService,
    private readonly lift: LiftService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  list(): Promise<GoalEntity[]> {
    return this.goals.find({ order: { createdAt: 'ASC' } });
  }

  async findById(id: string): Promise<GoalEntity> {
    const g = await this.goals.findOne({ where: { id } });
    if (!g) throw new NotFoundException(`goal ${id} not found`);
    return g;
  }

  async create(input: CreateGoalInput): Promise<GoalEntity> {
    assertLimitWindow(input.limitWindow);
    assertCompletionLimit(input.completionLimit);
    const kind: GoalKind = input.kind ?? 'flat';
    const { points, tierValues } = normalizeReward(
      kind,
      input.points,
      input.tierValues,
    );
    await this.assertCategoryExists(input.categoryId);
    if (input.assignedToUserId) await this.assertUserExists(input.assignedToUserId);

    const entity = this.goals.create({
      name: input.name.trim(),
      icon: input.icon ?? null,
      note: input.note ?? null,
      categoryId: input.categoryId,
      kind,
      points,
      tierValues,
      completionLimit: input.completionLimit,
      limitWindow: input.limitWindow,
      showInCatalog: input.showInCatalog ?? true,
      usableAsRemediation: input.usableAsRemediation ?? false,
      assignedToUserId: input.assignedToUserId ?? null,
      active: input.active ?? true,
      celebrationVariantId: input.celebrationVariantId ?? null,
    });
    const saved = await this.goals.save(entity);
    this.bus.emit({ kind: 'goals:changed' });
    return saved;
  }

  async update(id: string, patch: UpdateGoalInput): Promise<GoalEntity> {
    const goal = await this.findById(id);
    if (patch.name !== undefined) goal.name = patch.name.trim();
    if (patch.icon !== undefined) goal.icon = patch.icon;
    if (patch.note !== undefined) goal.note = patch.note;
    if (patch.categoryId !== undefined) {
      await this.assertCategoryExists(patch.categoryId);
      goal.categoryId = patch.categoryId;
    }
    const nextKind: GoalKind = patch.kind ?? goal.kind;
    if (
      patch.kind !== undefined ||
      patch.points !== undefined ||
      patch.tierValues !== undefined
    ) {
      const nextPoints =
        patch.points !== undefined ? patch.points : goal.points;
      const nextTiers =
        patch.tierValues !== undefined ? patch.tierValues : goal.tierValues;
      const { points, tierValues } = normalizeReward(
        nextKind,
        nextPoints,
        nextTiers,
      );
      goal.kind = nextKind;
      goal.points = points;
      goal.tierValues = tierValues;
    }
    if (patch.completionLimit !== undefined) {
      assertCompletionLimit(patch.completionLimit);
      goal.completionLimit = patch.completionLimit;
    }
    if (patch.limitWindow !== undefined) {
      assertLimitWindow(patch.limitWindow);
      goal.limitWindow = patch.limitWindow;
    }
    if (patch.showInCatalog !== undefined) goal.showInCatalog = patch.showInCatalog;
    if (patch.usableAsRemediation !== undefined) {
      goal.usableAsRemediation = patch.usableAsRemediation;
    }
    if (patch.assignedToUserId !== undefined) {
      if (patch.assignedToUserId) await this.assertUserExists(patch.assignedToUserId);
      goal.assignedToUserId = patch.assignedToUserId;
    }
    if (patch.active !== undefined) goal.active = patch.active;
    if (patch.celebrationVariantId !== undefined) {
      goal.celebrationVariantId = patch.celebrationVariantId;
    }
    const saved = await this.goals.save(goal);
    this.bus.emit({ kind: 'goals:changed' });
    return saved;
  }

  async remove(id: string): Promise<void> {
    const goal = await this.findById(id);
    await this.goals.remove(goal);
    this.bus.emit({ kind: 'goals:changed' });
  }

  /**
   * Catalog view for a Trackee tab: active, show_in_catalog goals visible to
   * this user (unassigned, or assigned to them). Each entry carries the
   * current-window remaining count so the tablet can disable maxed-out cards.
   */
  async catalogFor(userId: string, now: Date = this.clock.now()): Promise<CatalogGoal[]> {
    const timeZone = await this.settings.timeZone();
    const goals = await this.goals.find({
      where: { active: true, showInCatalog: true },
      order: { createdAt: 'ASC' },
    });
    const visible = goals.filter(
      (g) => g.assignedToUserId === null || g.assignedToUserId === userId,
    );
    const result: CatalogGoal[] = [];
    for (const goal of visible) {
      const completions = await this.completions.find({
        where: { goalId: goal.id, userId },
      });
      const remaining = remainingInWindow(
        { completionLimit: goal.completionLimit, limitWindow: goal.limitWindow },
        now,
        completions,
        { timeZone },
      );
      result.push({ goal, remaining, maxedOut: remaining === 0 });
    }
    return result;
  }

  /**
   * Record a goal completion for the given Trackee. Enforces the limit engine
   * and posts an `earn` Transaction with `reason = "goal: <name>"` and
   * `goal_completion_id` linked back. For Tiered goals the caller supplies the
   * picked `tierValue`; the resulting earn equals that picked value.
   */
  async complete(
    goalId: string,
    userId: string,
    now: Date = this.clock.now(),
    tierValue?: number,
  ): Promise<{ completion: GoalCompletionEntity; amount: number }> {
    const goal = await this.findById(goalId);
    if (!goal.active) throw new BadRequestException(`goal ${goal.name} is inactive`);
    if (goal.assignedToUserId && goal.assignedToUserId !== userId) {
      throw new BadRequestException(
        `goal "${goal.name}" is assigned to a different Trackee`,
      );
    }
    await this.assertUserExists(userId);

    let amount: number;
    if (goal.kind === 'tiered') {
      if (tierValue === undefined) {
        throw new BadRequestException(
          `goal "${goal.name}" is tiered; tier_value required`,
        );
      }
      if (!goal.tierValues.includes(tierValue)) {
        throw new BadRequestException(
          `tier_value ${tierValue} is not one of ${goal.tierValues.join(', ')}`,
        );
      }
      amount = tierValue;
    } else {
      if (tierValue !== undefined && tierValue !== goal.points) {
        throw new BadRequestException(
          `goal "${goal.name}" is flat; tier_value must be omitted`,
        );
      }
      amount = goal.points;
    }

    const timeZone = await this.settings.timeZone();
    const prior = await this.completions.find({
      where: { goalId: goal.id, userId },
    });
    const allowed = canComplete(
      { completionLimit: goal.completionLimit, limitWindow: goal.limitWindow },
      now,
      prior,
      { timeZone },
    );
    if (!allowed) {
      throw new BadRequestException(
        `goal "${goal.name}" is maxed out for the current ${goal.limitWindow}`,
      );
    }

    const completion = await this.completions.save(
      this.completions.create({
        goalId: goal.id,
        userId,
        tierValue: amount,
        completedAt: now,
      }),
    );

    // Completing a goal also clears any in-progress entry for it. Goal is done.
    const cleared = await this.inProgress.delete({ userId, goalId: goal.id });
    if ((cleared.affected ?? 0) > 0) {
      this.bus.emit({ kind: 'goals:user-changed', userId });
    }

    await this.txns.append({
      userId,
      kind: 'earn',
      amount,
      reason: `goal: ${goal.name}`,
      goalCompletionId: completion.id,
    });
    this.bus.emit({ kind: 'transactions:changed', userId });
    this.bus.emit({
      kind: 'goals:completed',
      userId,
      goalId: goal.id,
      goalName: goal.name,
      amount,
      celebrationVariantId: goal.celebrationVariantId,
    });
    return { completion, amount };
  }

  /**
   * Goal-as-remediation. Posts the normal goal completion (earn + completion
   * row) and additionally records the completion as the Restriction's
   * remediation: `goal_completions.remediation_for_restriction_id` is set,
   * and the Restriction is lifted (per ADR-0004 a remediation goal met clears
   * all Causes).
   *
   * The goal must be listed in the Restriction's `effective_remediation_goals`.
   */
  async completeAsRemediation(
    goalId: string,
    userId: string,
    restrictionId: string,
    now: Date = this.clock.now(),
    tierValue?: number,
  ): Promise<{ completion: GoalCompletionEntity; amount: number }> {
    const restriction = await this.restrictionRepo.findOne({
      where: { id: restrictionId, userId },
    });
    if (!restriction || restriction.liftedAt !== null) {
      throw new BadRequestException(
        `restriction ${restrictionId} is not active for user ${userId}`,
      );
    }
    if (!restriction.effectiveRemediationGoals.includes(goalId)) {
      throw new BadRequestException(
        `goal ${goalId} is not an effective remediation for restriction ${restrictionId}`,
      );
    }

    const result = await this.complete(goalId, userId, now, tierValue);
    await this.completions.update(
      { id: result.completion.id },
      { remediationForRestrictionId: restrictionId },
    );
    result.completion.remediationForRestrictionId = restrictionId;

    // Goal remediation Lift mechanism (ADR-0004, GLOSSARY — Lift mechanism).
    // Clears every Cause; the Lift module handles enforcement deactivation
    // and event emission.
    await this.lift.applyLift({
      mechanism: 'goal_remediation',
      filter: { kind: 'all_for_restriction', restrictionId },
    });

    return result;
  }

  async listFavorites(userId: string): Promise<string[]> {
    const rows = await this.favorites.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
    return rows.map((r) => r.goalId);
  }

  async setFavorite(
    userId: string,
    goalId: string,
    favorite: boolean,
  ): Promise<void> {
    await this.findById(goalId);
    await this.assertUserExists(userId);
    if (favorite) {
      const existing = await this.favorites.findOne({
        where: { userId, goalId },
      });
      if (existing) return;
      await this.favorites.save(this.favorites.create({ userId, goalId }));
    } else {
      const removed = await this.favorites.delete({ userId, goalId });
      if ((removed.affected ?? 0) === 0) return;
    }
    this.bus.emit({ kind: 'goals:user-changed', userId });
  }

  async listInProgress(userId: string): Promise<InProgressItem[]> {
    const rows = await this.inProgress.find({
      where: { userId },
      order: { startedAt: 'ASC' },
    });
    return rows.map((r) => ({ goalId: r.goalId, startedAt: r.startedAt }));
  }

  /**
   * Mark a goal in-progress for this Trackee. Soft-capped at IN_PROGRESS_CAP
   * via auto-evict: if the user already has the cap (and this goalId isn't
   * one of them), the oldest row is deleted before insert. Re-marking an
   * already-in-progress goal is a no-op.
   */
  async addInProgress(
    userId: string,
    goalId: string,
    now: Date = this.clock.now(),
  ): Promise<void> {
    await this.findById(goalId);
    await this.assertUserExists(userId);
    const existing = await this.inProgress.findOne({
      where: { userId, goalId },
    });
    if (existing) return;
    const current = await this.inProgress.find({
      where: { userId },
      order: { startedAt: 'ASC' },
    });
    if (current.length >= IN_PROGRESS_CAP) {
      const overflow = current.length - IN_PROGRESS_CAP + 1;
      const toEvict = current.slice(0, overflow);
      await this.inProgress.remove(toEvict);
    }
    await this.inProgress.save(
      this.inProgress.create({ userId, goalId, startedAt: now }),
    );
    this.bus.emit({ kind: 'goals:user-changed', userId });
  }

  async removeInProgress(userId: string, goalId: string): Promise<void> {
    const removed = await this.inProgress.delete({ userId, goalId });
    if ((removed.affected ?? 0) === 0) return;
    this.bus.emit({ kind: 'goals:user-changed', userId });
  }

  /**
   * Most-recent distinct goals the user has completed, newest first. Returns
   * up to `limit` goal IDs. Powers the Routine "Recently completed" teaser.
   */
  async recentCompletions(
    userId: string,
    limit = 3,
  ): Promise<{ goalId: string; completedAt: Date }[]> {
    const rows = await this.completions.find({
      where: { userId },
      order: { completedAt: 'DESC' },
    });
    const seen = new Set<string>();
    const out: { goalId: string; completedAt: Date }[] = [];
    for (const r of rows) {
      if (seen.has(r.goalId)) continue;
      seen.add(r.goalId);
      out.push({ goalId: r.goalId, completedAt: r.completedAt });
      if (out.length >= limit) break;
    }
    return out;
  }

  private async assertCategoryExists(id: string): Promise<void> {
    const c = await this.categories.findOne({ where: { id } });
    if (!c) throw new BadRequestException(`category ${id} not found`);
  }

  private async assertUserExists(id: string): Promise<void> {
    const u = await this.users.findOne({
      where: { id, deactivatedAt: IsNull() },
    });
    if (!u) throw new BadRequestException(`user ${id} not found or deactivated`);
  }
}

function assertLimitWindow(v: string): asserts v is LimitWindow {
  if (!['day', 'week', 'month', 'lifetime'].includes(v)) {
    throw new BadRequestException(`invalid limit_window: ${v}`);
  }
}

function assertCompletionLimit(v: number): void {
  if (!Number.isInteger(v) || v < 1 || v > 999) {
    throw new BadRequestException('completion_limit must be an integer in [1, 999]');
  }
}

function assertPoints(v: number): void {
  if (!Number.isInteger(v) || v < 0) {
    throw new BadRequestException('points must be a non-negative integer');
  }
}

function normalizeReward(
  kind: GoalKind,
  points: number | undefined,
  tierValues: number[] | undefined,
): { points: number; tierValues: number[] } {
  if (kind === 'tiered') {
    if (!tierValues || tierValues.length === 0) {
      throw new BadRequestException('tiered goal requires at least one tier_value');
    }
    for (const v of tierValues) {
      if (!Number.isInteger(v) || v < 1) {
        throw new BadRequestException('tier_values must be positive integers');
      }
    }
    return { points: 0, tierValues };
  }
  const p = points ?? 0;
  assertPoints(p);
  return { points: p, tierValues: [] };
}
