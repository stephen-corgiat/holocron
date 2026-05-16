import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DailyStreakEntity } from './daily-streak.entity';
import { OccurrenceEntity } from './occurrence.entity';
import { UserEntity } from '../users/user.entity';
import { TransactionsService } from '../transactions/transactions.service';
import { RealtimeBus } from '../realtime/realtime-bus';
import { applyDay, classifyDay } from './daily-streak-engine';
import { PresenceService } from '../presence/presence.service';
import { isSuppressed } from '../presence/presence-resolver';
import {
  DEFAULT_DAILY_BONUS,
  DEFAULT_TIME_ZONE,
  HouseholdSettingsService,
} from '../household-settings/household-settings.service';
import { endOfDayInTz, isoDateInTz, startOfDayInTz, ymdInTz } from '../clock/tz';

/**
 * Day-rollover sweep that classifies each Trackee's day, persists the next
 * streak state, and posts the qualifying-advance bonus as an `earn`
 * transaction.
 */
@Injectable()
export class DailyStreakService {
  private readonly logger = new Logger('DailyStreakService');

  constructor(
    @InjectRepository(DailyStreakEntity)
    private readonly streaks: Repository<DailyStreakEntity>,
    @InjectRepository(OccurrenceEntity)
    private readonly occurrences: Repository<OccurrenceEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly transactions: TransactionsService,
    private readonly bus: RealtimeBus,
    @Inject(forwardRef(() => PresenceService))
    private readonly presence: PresenceService,
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

  async rolloverDay(
    date: Date,
    bonusAmount?: number,
  ): Promise<{ processed: number; bonuses: number }> {
    const tz = await this.tz();
    const bonus = bonusAmount ?? (await this.bonusAmount());
    const dayIso = isoDateInTz(date, tz);
    const trackees = await this.users.find();
    let bonuses = 0;

    for (const user of trackees) {
      if (user.deactivatedAt) continue;
      const occs = await this.occurrencesForDay(user.id, date, tz);
      const schedule = await this.presence.findByUserId(user.id).catch(() => null);
      const classification = classifyDay(
        occs.map((o) => ({
          isReminder: o.task?.kind === 'reminder',
          status: o.status,
          presenceSuppressed: schedule
            ? isSuppressed(
                schedule,
                o.task?.kind === 'windowed' && o.windowEnd
                  ? o.windowEnd
                  : o.scheduledAt,
                tz,
              )
            : false,
        })),
      );

      const prior = await this.streaks.findOne({ where: { userId: user.id } });
      const priorState = prior
        ? { count: prior.count, lastQualifyingDay: prior.lastQualifyingDay }
        : { count: 0, lastQualifyingDay: null };

      const result = applyDay(priorState, classification, {
        userId: user.id,
        day: dayIso,
        bonusAmount: bonus,
      });

      if (prior) {
        prior.count = result.state.count;
        prior.lastQualifyingDay = result.state.lastQualifyingDay;
        await this.streaks.save(prior);
      } else {
        await this.streaks.save(
          this.streaks.create({
            userId: user.id,
            count: result.state.count,
            lastQualifyingDay: result.state.lastQualifyingDay,
          }),
        );
      }

      if (result.bonusTxn) {
        await this.transactions.append({
          userId: result.bonusTxn.userId,
          kind: 'earn',
          amount: result.bonusTxn.amount,
          reason: result.bonusTxn.reason,
        });
        this.bus.emit({ kind: 'transactions:changed', userId: user.id });
        bonuses += 1;
      }
    }

    if (bonuses > 0) this.logger.log(`paid ${bonuses} daily-routine-streak bonus(es) for ${dayIso}`);
    return { processed: trackees.length, bonuses };
  }

  private async occurrencesForDay(userId: string, date: Date, tz: string) {
    const ymd = ymdInTz(date, tz);
    const start = startOfDayInTz(ymd, tz);
    const end = endOfDayInTz(ymd, tz);
    // Windowed occurrences land on the streak day of `window_end`, not
    // `scheduled_at`. Non-windowed have window_end NULL
    // and continue to bind by `scheduled_at`.
    return this.occurrences
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.task', 't')
      .where('o.user_id = :userId', { userId })
      .andWhere(
        '((o.window_end IS NULL AND o.scheduled_at BETWEEN :start AND :end) ' +
          'OR (o.window_end IS NOT NULL AND o.window_end BETWEEN :start AND :end))',
        { start, end },
      )
      .getMany();
  }
}

