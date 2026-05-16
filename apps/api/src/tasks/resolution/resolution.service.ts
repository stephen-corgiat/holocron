import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { CLOCK, Clock } from '../../clock/clock';
import { LiftService } from '../../restrictions/lift';
import { RestrictionsService } from '../../restrictions/restrictions.service';
import { TransactionEntity } from '../../transactions/transaction.entity';
import { DailyStreakEntity } from '../daily-streak.entity';
import { LadderPositionEntity } from '../ladder-position.entity';
import { OccurrenceEntity } from '../occurrence.entity';
import { TaskEntity } from '../task.entity';
import { RealtimeBus } from '../../realtime/realtime-bus';
import {
  DEFAULT_TIME_ZONE,
  HouseholdSettingsService,
} from '../../household-settings/household-settings.service';
import { isoDateInTz } from '../../clock/tz';
import { resolve } from './resolution-engine';
import {
  LedgerOp,
  OccurrenceSnapshot,
  ResolutionEffects,
  ResolutionIntent,
  ResolutionResult,
} from './types';

/**
 * Occurrence resolution applier (GLOSSARY — Occurrence resolution).
 *
 * One entry point — `apply(occurrenceId, intent)`. Loads the snapshot from
 * repos, calls the pure engine, then opens a single DB transaction in which
 * it applies: status + pendingSince, ledger rows (all stamped with a shared
 * `txn_group_id`), ladder, daily-streak repair (late-complete only), and any
 * spawned occurrence (defer only). Restriction apply/remove fires post-
 * commit (best-effort; matches the prior `applyMissOutcome` /
 * `removeCausesByOccurrence` pattern). Events fan out post-commit.
 *
 * The engine returns one of three results — `effects` (apply the bucket),
 * `noop` (intent is idempotent for this state — return silently), or
 * `rejected` (intent is illegal — throw BadRequestException).
 */
@Injectable()
export class ResolutionService {
  private readonly logger = new Logger('ResolutionService');

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(OccurrenceEntity)
    private readonly occurrences: Repository<OccurrenceEntity>,
    @InjectRepository(LadderPositionEntity)
    private readonly positions: Repository<LadderPositionEntity>,
    @InjectRepository(DailyStreakEntity)
    private readonly streaks: Repository<DailyStreakEntity>,
    @InjectRepository(TransactionEntity)
    private readonly transactions: Repository<TransactionEntity>,
    private readonly bus: RealtimeBus,
    @Inject(forwardRef(() => RestrictionsService))
    private readonly restrictions: RestrictionsService,
    private readonly lift: LiftService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly householdSettings?: HouseholdSettingsService,
  ) {}

  private async tz(): Promise<string> {
    if (!this.householdSettings) return DEFAULT_TIME_ZONE;
    try {
      return await this.householdSettings.timeZone();
    } catch {
      return DEFAULT_TIME_ZONE;
    }
  }

  /**
   * Public entry. Returns the post-resolution OccurrenceEntity (refreshed
   * from the DB). For intent `defer`, the spawned occurrence is loaded via
   * `getDeferredOccurrence(originalId)` after the call.
   */
  async apply(
    occurrenceId: string,
    intent: ResolutionIntent,
  ): Promise<{
    occurrence: OccurrenceEntity & { task: TaskEntity };
    result: ResolutionResult;
    newOccurrenceId: string | null;
  }> {
    const snapshot = await this.loadSnapshot(occurrenceId);
    const now = this.clock.now();
    const tz = await this.tz();
    const result = resolve(snapshot, intent, now, tz);

    if (result.kind === 'rejected') {
      throw new BadRequestException(result.reason);
    }
    if (result.kind === 'noop') {
      const occ = await this.reload(occurrenceId);
      return { occurrence: occ, result, newOccurrenceId: null };
    }

    const groupId = randomUUID();
    const newOccurrenceId = await this.applyEffects(
      snapshot,
      result.effects,
      groupId,
    );

    // Post-commit side effects.
    if (result.effects.restriction) {
      try {
        if (result.effects.restriction.direction === 'apply') {
          await this.restrictions.applyMissCause(result.effects.restriction.cause);
        } else {
          await this.lift.applyLift(result.effects.restriction.lift);
        }
      } catch (err) {
        this.logger.warn(
          `restriction side-effect failed occ=${occurrenceId}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }

    this.bus.emit({ kind: 'tasks:changed' });
    if (result.effects.ledger.length > 0) {
      this.bus.emit({
        kind: 'transactions:changed',
        userId: snapshot.occurrence.userId,
      });
    }

    const occ = await this.reload(occurrenceId);
    return { occurrence: occ, result, newOccurrenceId };
  }

  /** For the defer caller: loads the spawned occurrence by id. */
  async getOccurrence(
    id: string,
  ): Promise<(OccurrenceEntity & { task: TaskEntity }) | null> {
    const occ = await this.occurrences.findOne({
      where: { id },
      relations: { task: true },
    });
    return (occ as (OccurrenceEntity & { task: TaskEntity }) | null) ?? null;
  }

  private async loadSnapshot(occurrenceId: string): Promise<OccurrenceSnapshot> {
    const occ = await this.occurrences.findOne({
      where: { id: occurrenceId },
      relations: { task: true },
    });
    if (!occ) {
      throw new NotFoundException(`occurrence ${occurrenceId} not found`);
    }
    if (!occ.task) {
      throw new BadRequestException(
        `occurrence ${occurrenceId} has no associated task`,
      );
    }
    const [position, earns, penalties] = await Promise.all([
      this.positions.findOne({
        where: { taskId: occ.taskId, userId: occ.userId },
      }),
      this.transactions.find({
        where: { occurrenceId: occ.id, kind: 'earn' },
      }),
      this.transactions.find({
        where: { occurrenceId: occ.id, kind: 'penalty' },
      }),
    ]);
    const priorEarnTotal = earns.reduce((acc, t) => acc + t.amount, 0);
    const priorPenaltyTotal = penalties.reduce((acc, t) => acc + t.amount, 0);
    // For windowed tasks the engine's "past deadline" check needs to be
    // keyed off window_end, not scheduledAt (the window_start).
    const deadline =
      occ.task.kind === 'windowed' && occ.windowEnd ? occ.windowEnd : undefined;
    return {
      occurrence: {
        id: occ.id,
        taskId: occ.taskId,
        userId: occ.userId,
        scheduledAt: occ.scheduledAt,
        deadline,
        status: occ.status,
        pendingSince: occ.pendingSince ?? null,
      },
      task: {
        id: occ.task.id,
        name: occ.task.name,
        kind: occ.task.kind,
        points: occ.task.points,
        requiresVerification: occ.task.requiresVerification === true,
        allowLateCompletion: occ.task.allowLateCompletion === true,
        lateWindowMinutes: occ.task.lateWindowMinutes ?? 720,
        ladderResetThreshold: occ.task.ladderResetThreshold ?? 3,
        ladder: occ.task.ladder,
      },
      ladderPosition: position?.position ?? 1,
      cleanStreakCount: position?.cleanStreakCount ?? 0,
      priorEarnTotal,
      priorPenaltyTotal,
    };
  }

  private async applyEffects(
    snapshot: OccurrenceSnapshot,
    effects: ResolutionEffects,
    groupId: string,
  ): Promise<string | null> {
    let newOccurrenceId: string | null = null;
    await this.dataSource.transaction(async (trx) => {
      const occRepo = trx.getRepository(OccurrenceEntity);
      await occRepo.update(
        { id: snapshot.occurrence.id },
        { status: effects.status, pendingSince: effects.pendingSince },
      );

      for (const op of effects.ledger) {
        await this.appendLedger(trx, snapshot.occurrence, op, groupId);
      }

      if (effects.ladder) {
        await this.applyLadder(trx, snapshot, effects.ladder);
      }

      if (effects.dailyStreak === 'late_complete_repair') {
        await this.applyDailyStreakRepair(trx, snapshot);
      }

      if (effects.newOccurrence) {
        const created = await occRepo.save(
          occRepo.create({
            taskId: snapshot.occurrence.taskId,
            userId: snapshot.occurrence.userId,
            scheduledAt: effects.newOccurrence.scheduledAt,
            localDay: isoDateInTz(
              effects.newOccurrence.scheduledAt,
              await this.tz(),
            ),
            status: 'active',
            deferredFromOccurrenceId: effects.newOccurrence.deferredFromOccurrenceId,
          }),
        );
        newOccurrenceId = created.id;
      }
    });
    return newOccurrenceId;
  }

  private async appendLedger(
    trx: EntityManager,
    occ: OccurrenceSnapshot['occurrence'],
    op: LedgerOp,
    groupId: string,
  ): Promise<void> {
    const repo = trx.getRepository(TransactionEntity);
    await repo.save(
      repo.create({
        userId: occ.userId,
        kind: op.kind,
        amount: op.amount,
        reason: op.reason,
        adminUserId: op.adminUserId ?? null,
        occurrenceId: occ.id,
        txnGroupId: groupId,
      }),
    );
  }

  private async applyLadder(
    trx: EntityManager,
    snapshot: OccurrenceSnapshot,
    ladder: NonNullable<ResolutionEffects['ladder']>,
  ): Promise<void> {
    const repo = trx.getRepository(LadderPositionEntity);
    const existing = await repo.findOne({
      where: {
        taskId: snapshot.occurrence.taskId,
        userId: snapshot.occurrence.userId,
      },
    });

    if (ladder === 'clean_streak_advance') {
      if (snapshot.task.kind !== 'recurring' && snapshot.task.kind !== 'windowed') {
        return;
      }
      const threshold = snapshot.task.ladderResetThreshold;
      if (!existing) {
        await repo.save(
          repo.create({
            taskId: snapshot.occurrence.taskId,
            userId: snapshot.occurrence.userId,
            position: 1,
            cleanStreakCount: 1,
          }),
        );
        return;
      }
      const nextCount = existing.cleanStreakCount + 1;
      if (nextCount >= threshold && existing.position > 1) {
        existing.position = 1;
        existing.cleanStreakCount = 0;
      } else {
        existing.cleanStreakCount = nextCount;
      }
      await repo.save(existing);
      return;
    }

    if (ladder === 'retract_one') {
      if (existing && existing.position > 1) {
        existing.position = existing.position - 1;
        await repo.save(existing);
      }
      return;
    }

    // { kind: 'advance_to', to }
    if (existing) {
      existing.position = ladder.to;
      existing.cleanStreakCount = 0;
      await repo.save(existing);
    } else {
      await repo.save(
        repo.create({
          taskId: snapshot.occurrence.taskId,
          userId: snapshot.occurrence.userId,
          position: ladder.to,
          cleanStreakCount: 0,
        }),
      );
    }
  }

  private async applyDailyStreakRepair(
    trx: EntityManager,
    snapshot: OccurrenceSnapshot,
  ): Promise<void> {
    const repo = trx.getRepository(DailyStreakEntity);
    const streak = await repo.findOne({
      where: { userId: snapshot.occurrence.userId },
    });
    if (!streak) return;
    streak.count = streak.count + 1;
    const day = isoDateInTz(snapshot.occurrence.scheduledAt, await this.tz());
    if (!streak.lastQualifyingDay || streak.lastQualifyingDay < day) {
      streak.lastQualifyingDay = day;
    }
    await repo.save(streak);
  }

  private async reload(
    occurrenceId: string,
  ): Promise<OccurrenceEntity & { task: TaskEntity }> {
    const occ = await this.occurrences.findOne({
      where: { id: occurrenceId },
      relations: { task: true },
    });
    if (!occ) {
      throw new NotFoundException(`occurrence ${occurrenceId} not found`);
    }
    return occ as OccurrenceEntity & { task: TaskEntity };
  }
}

