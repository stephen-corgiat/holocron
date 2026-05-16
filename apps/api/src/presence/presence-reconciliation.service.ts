import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, Repository } from 'typeorm';
import { OccurrenceEntity } from '../tasks/occurrence.entity';
import { TaskEntity } from '../tasks/task.entity';
import { LadderPositionEntity } from '../tasks/ladder-position.entity';
import { DailyStreakEntity } from '../tasks/daily-streak.entity';
import { TransactionEntity } from '../transactions/transaction.entity';
import { UserEntity } from '../users/user.entity';
import { ResolutionService } from '../tasks/resolution';
import { RealtimeBus } from '../realtime/realtime-bus';
import { classifyDay } from '../tasks/daily-streak-engine';
import { reconcileStreak } from './streak-reconciliation-engine';
import { CLOCK, Clock } from '../clock/clock';
import {
  ReconcileEvent,
  affectedDateRange,
  reconcile,
} from './presence-reconcile';
import { isSuppressed, PresenceScheduleLike } from './presence-resolver';
import {
  DEFAULT_DAILY_BONUS,
  DEFAULT_TIME_ZONE,
  HouseholdSettingsService,
} from '../household-settings/household-settings.service';
import {
  addDaysInTz,
  endOfDayInTz,
  isoDateInTz,
  startOfDayInTz,
  ymdInTz,
  type Ymd,
} from '../clock/tz';

const FALLBACK_WINDOW_DAYS = 90;
const STREAK_BONUS_REASON = 'daily routine streak';

/**
 * Orchestrator for ADR-0003 reconciliation. Consumes the pure event list
 * produced by `reconcile()` and applies ledger / state mutations atomically.
 *
 * Wired into `PresenceService` writes: every schedule edit (recurring rule,
 * grid, epoch, vacation windows) calls `reconcileForUser` with the
 * before/after snapshots. The work is bounded to the affected date range —
 * vacation changes bound to window dates; recurring-rule changes fall back
 * to a trailing 90-day window.
 */
@Injectable()
export class PresenceReconciliationService {
  private readonly logger = new Logger('PresenceReconciliationService');

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(OccurrenceEntity)
    private readonly occurrences: Repository<OccurrenceEntity>,
    @InjectRepository(TransactionEntity)
    private readonly transactions: Repository<TransactionEntity>,
    @InjectRepository(LadderPositionEntity)
    private readonly positions: Repository<LadderPositionEntity>,
    @InjectRepository(DailyStreakEntity)
    private readonly streaks: Repository<DailyStreakEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @Inject(forwardRef(() => ResolutionService))
    private readonly resolution: ResolutionService,
    private readonly bus: RealtimeBus,
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

  /** Configured streak-advance bonus, falling back to the default if settings is unavailable. */
  private async bonusAmount(): Promise<number> {
    if (!this.householdSettings) return DEFAULT_DAILY_BONUS;
    try {
      return await this.householdSettings.dailyBonusAmount();
    } catch {
      return DEFAULT_DAILY_BONUS;
    }
  }

  async reconcileForUser(
    userId: string,
    oldSchedule: PresenceScheduleLike,
    newSchedule: PresenceScheduleLike,
    now: Date = this.clock.now(),
  ): Promise<{ events: ReconcileEvent[]; range: { start: Date; end: Date } | null }> {
    const tz = await this.tz();
    const range = this.resolveRange(oldSchedule, newSchedule, now, tz);
    if (!range) return { events: [], range: null };

    const occRows = await this.occurrences.find({
      where: { userId, scheduledAt: Between(range.start, range.end) },
      relations: { task: true },
    });

    const events = reconcile({
      oldSchedule,
      newSchedule,
      now,
      tz,
      occurrences: occRows.map((o) => ({
        id: o.id,
        taskId: o.taskId,
        userId: o.userId,
        scheduledAt: o.scheduledAt,
        status: o.status,
      })),
    });

    if (events.length === 0) return { events, range };

    const occById = new Map(occRows.map((o) => [o.id, o]));
    let touchedTransactions = false;
    for (const ev of events) {
      if (ev.kind === 'LedgerReversal') {
        const occ = occById.get(ev.occurrenceId);
        if (occ) {
          await this.reverseMissEffects(occ);
          touchedTransactions = true;
        }
      } else if (ev.kind === 'MissFire') {
        const occ = occById.get(ev.occurrenceId);
        if (occ) {
          await this.fireRetroMiss(occ);
          touchedTransactions = true;
        }
      } else if (ev.kind === 'StreakRecompute') {
        const paid = await this.recomputeStreak(
          ev.userId,
          ev.days,
          newSchedule,
          tz,
        );
        if (paid) touchedTransactions = true;
      }
    }

    this.bus.emit({ kind: 'tasks:changed' });
    if (touchedTransactions) {
      this.bus.emit({ kind: 'transactions:changed', userId });
    }
    this.logger.log(
      `reconciled user=${userId} events=${events.length} range=${range.start.toISOString()}..${range.end.toISOString()}`,
    );
    return { events, range };
  }

  private resolveRange(
    oldSchedule: PresenceScheduleLike,
    newSchedule: PresenceScheduleLike,
    now: Date,
    tz: string,
  ): { start: Date; end: Date } | null {
    const iso = affectedDateRange(oldSchedule, newSchedule);
    if (iso) {
      return {
        start: startOfDayInTz(ymdFromIso(iso.start), tz),
        end: endOfDayInTz(ymdFromIso(iso.end), tz),
      };
    }
    // Open-ended recurring-rule change: fall back to a bounded trailing
    // window so reconciliation work stays small.
    const ruleDiffers =
      oldSchedule.recurringRuleKind !== newSchedule.recurringRuleKind ||
      oldSchedule.gridNWeeks !== newSchedule.gridNWeeks ||
      oldSchedule.epochDate !== newSchedule.epochDate ||
      JSON.stringify(oldSchedule.gridCells ?? null) !==
        JSON.stringify(newSchedule.gridCells ?? null);
    if (!ruleDiffers) return null;
    const todayYmd = ymdInTz(now, tz);
    return {
      start: addDaysInTz(startOfDayInTz(todayYmd, tz), -FALLBACK_WINDOW_DAYS, tz),
      end: endOfDayInTz(todayYmd, tz),
    };
  }

  /**
   * Undo a previously-fired Miss: claw back the penalty txn, retract the
   * ladder position by one tier, flip the occurrence back to `active` so
   * subsequent reads see it as derived-suppressed.
   */
  private async reverseMissEffects(occ: OccurrenceEntity): Promise<void> {
    await this.dataSource.transaction(async (trx) => {
      const penalties = await trx.getRepository(TransactionEntity).find({
        where: { occurrenceId: occ.id, kind: 'penalty' },
      });
      const total = penalties.reduce((acc, t) => acc + Math.abs(t.amount), 0);
      if (total > 0) {
        await trx.getRepository(TransactionEntity).save(
          trx.getRepository(TransactionEntity).create({
            userId: occ.userId,
            kind: 'claw_back',
            amount: total,
            reason: `${occ.task?.name ?? 'Miss'} — presence-suppressed`,
            occurrenceId: occ.id,
            txnGroupId: penalties[0]?.txnGroupId ?? null,
          }),
        );
      }

      await trx.getRepository(OccurrenceEntity).update(
        { id: occ.id },
        { status: 'active', pendingSince: null },
      );

      // Retract ladder one tier (idempotent at floor of 1). The Miss-engine
      // advances by one on each fire (`step` in escalation-ladder), so
      // reversing one Miss retracts by one.
      const pos = await trx.getRepository(LadderPositionEntity).findOne({
        where: { taskId: occ.taskId, userId: occ.userId },
      });
      if (pos && pos.position > 1) {
        pos.position = pos.position - 1;
        pos.cleanStreakCount = 0;
        await trx.getRepository(LadderPositionEntity).save(pos);
      }
    });
  }

  /**
   * Fire a retroactive Miss for an occurrence that's newly no-longer-
   * suppressed and past-deadline. Delegates to the Resolution engine's
   * `evaluate_deadline` intent so the exact same four-effect tuple posts as
   * the deadline-tick sweep.
   */
  private async fireRetroMiss(occ: OccurrenceEntity): Promise<void> {
    if (!occ.task) return;
    const user = await this.users.findOne({ where: { id: occ.userId } });
    const isRestrictable = user?.isRestrictable === true;
    await this.resolution.apply(occ.id, {
      kind: 'evaluate_deadline',
      isRestrictable,
      presenceSuppressed: false,
    });
  }

  /**
   * Re-derive the Trackee's Daily routine streak for the days touched by
   * reconciliation. Builds per-day inputs (classification + existing-bonus
   * lookup) from repos, hands them to the pure `reconcileStreak` engine to
   * decide transitions + final state, then applies the transitions (post /
   * claw_back ledger rows + save the streak state).
   */
  private async recomputeStreak(
    userId: string,
    days: string[],
    schedule: PresenceScheduleLike,
    tz: string,
  ): Promise<boolean> {
    if (days.length === 0) return false;
    const start = startOfDayInTz(ymdFromIso(days[0]), tz);
    const end = endOfDayInTz(ymdFromIso(days[days.length - 1]), tz);

    const occRows = await this.occurrences.find({
      where: { userId, scheduledAt: Between(start, end) },
      relations: { task: true },
    });
    const byDay = new Map<string, OccurrenceEntity[]>();
    for (const o of occRows) {
      const day = isoDateInTz(o.scheduledAt, tz);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(o);
    }

    const bonusRows = await this.transactions.find({
      where: { userId, kind: 'earn', reason: STREAK_BONUS_REASON },
    });
    const bonusByDay = new Map<string, TransactionEntity>();
    for (const t of bonusRows) {
      const day = isoDateInTz(t.createdAt, tz);
      if (days.includes(day)) bonusByDay.set(day, t);
    }

    const priorStreak = await this.streaks.findOne({ where: { userId } });
    const priorState = priorStreak
      ? { count: priorStreak.count, lastQualifyingDay: priorStreak.lastQualifyingDay }
      : { count: 0, lastQualifyingDay: null as string | null };

    // Build engine input: classify each day + look up existing bonus.
    const dayInputs = days.map((day) => {
      const occs = byDay.get(day) ?? [];
      const classification = classifyDay(
        occs.map((o) => ({
          isReminder: o.task?.kind === 'reminder',
          status: o.status,
          presenceSuppressed: isSuppressed(schedule, o.scheduledAt, tz),
        })),
      );
      const existing = bonusByDay.get(day);
      return {
        day,
        classification,
        existingBonusAmount: existing ? existing.amount : null,
      };
    });

    const { finalState, transitions } = reconcileStreak({
      priorState,
      days: dayInputs,
      bonusAmount: await this.bonusAmount(),
      bonusReason: STREAK_BONUS_REASON,
    });

    // Apply transitions.
    let touched = false;
    for (const tr of transitions) {
      const kind = tr.kind === 'post_bonus' ? 'earn' : 'claw_back';
      await this.transactions.save(
        this.transactions.create({
          userId,
          kind,
          amount: tr.amount,
          reason: tr.reason,
        }),
      );
      touched = true;
    }
    void finalState; // fall through to the priorStreak persistence below
    const state = finalState;

    if (priorStreak) {
      priorStreak.count = state.count;
      priorStreak.lastQualifyingDay = state.lastQualifyingDay;
      await this.streaks.save(priorStreak);
    } else if (state.count !== 0 || state.lastQualifyingDay !== null) {
      await this.streaks.save(
        this.streaks.create({
          userId,
          count: state.count,
          lastQualifyingDay: state.lastQualifyingDay,
        }),
      );
    }
    return touched;
  }

}

/** Parse an ISO `YYYY-MM-DD` string into an {@link Ymd} (month 0-indexed). */
function ymdFromIso(iso: string): Ymd {
  const [y, m, d] = iso.split('-').map(Number);
  return { year: y, month: (m ?? 1) - 1, day: d ?? 1 };
}

