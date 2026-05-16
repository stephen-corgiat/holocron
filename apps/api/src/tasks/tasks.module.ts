import {
  Module,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CLOCK, Clock } from '../clock/clock';
import { AuthModule } from '../auth/auth.module';
import { PresenceModule } from '../presence/presence.module';
import { UserEntity } from '../users/user.entity';
import { TaskEntity } from './task.entity';
import { OccurrenceEntity } from './occurrence.entity';
import { LadderPositionEntity } from './ladder-position.entity';
import { DailyStreakEntity } from './daily-streak.entity';
import { TransactionEntity } from '../transactions/transaction.entity';
import { TasksService } from './tasks.service';
import { OccurrencesService } from './occurrences.service';
import { MissService } from './miss.service';
import { DailyStreakService } from './daily-streak.service';
import { OccurrenceActionsService } from './occurrence-actions.service';
import { ResolutionService } from './resolution';
import { TasksController } from './tasks.controller';
import { OccurrencesController } from './occurrences.controller';
import { AdminOccurrencesController } from './admin-occurrences.controller';
import { TransactionsModule } from '../transactions/transactions.module';
import { RestrictionsModule } from '../restrictions/restrictions.module';
import { HouseholdSettingsModule } from '../household-settings/household-settings.module';
import {
  DEFAULT_TIME_ZONE,
  HouseholdSettingsService,
} from '../household-settings/household-settings.service';
import { addDaysInTz, minutesOfDayInTz } from '../clock/tz';
import { RealtimeBusModule } from '../realtime/realtime-bus.module';

const ONE_MINUTE_MS = 60_000;

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TaskEntity,
      OccurrenceEntity,
      UserEntity,
      LadderPositionEntity,
      DailyStreakEntity,
      TransactionEntity,
    ]),
    forwardRef(() => AuthModule),
    TransactionsModule,
    forwardRef(() => PresenceModule),
    RestrictionsModule,
    HouseholdSettingsModule,
    RealtimeBusModule,
  ],
  controllers: [TasksController, OccurrencesController, AdminOccurrencesController],
  providers: [
    TasksService,
    OccurrencesService,
    MissService,
    DailyStreakService,
    OccurrenceActionsService,
    ResolutionService,
  ],
  exports: [
    TasksService,
    OccurrencesService,
    MissService,
    DailyStreakService,
    OccurrenceActionsService,
    ResolutionService,
  ],
})
export class TasksModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('TasksModule');
  private missTimer: NodeJS.Timeout | null = null;
  private rolloverTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly occurrences: OccurrencesService,
    private readonly miss: MissService,
    private readonly dailyStreak: DailyStreakService,
    private readonly settings: HouseholdSettingsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async tz(): Promise<string> {
    try {
      return await this.settings.timeZone();
    } catch {
      return DEFAULT_TIME_ZONE;
    }
  }

  /**
   * Boot-time backfill + register the deadline-tick and day-rollover
   * schedulers. In E2E_TEST_MODE the schedulers
   * are not started — tests drive them via the `/_e2e/scheduler/tick`
   * endpoint to avoid racing the test.
   */
  async onModuleInit(): Promise<void> {
    // Re-anchor existing occurrences whenever the household zone changes so a
    // task's wall-clock due_time keeps its meaning (a 20:00 reminder stays
    // 20:00). Registered here because tasks already depends on settings;
    // settings stays unaware of tasks (no module cycle).
    this.settings.onTimeZoneChange(async (tz) => {
      try {
        await this.occurrences.reanchorToTimeZone(tz);
      } catch (err) {
        this.logger.warn(
          `re-anchor after time-zone change failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    });

    try {
      // Re-anchor (which also generates) rather than a bare generate: this
      // self-heals occurrences left stale by a zone change that happened while
      // the API was down, then materializes the current day.
      const tz = await this.tz();
      await this.occurrences.reanchorToTimeZone(tz);
    } catch (err) {
      this.logger.warn(
        `boot-time occurrence generation skipped: ${err instanceof Error ? err.message : err}`,
      );
    }

    if (process.env.E2E_TEST_MODE === 'true') return;

    this.missTimer = setInterval(() => {
      void this.miss.fireDeadlineTick(this.clock.now()).catch((err) => {
        this.logger.warn(
          `deadline tick failed: ${err instanceof Error ? err.message : err}`,
        );
      });
    }, ONE_MINUTE_MS);

    this.rolloverTimer = setInterval(() => {
      void (async () => {
        const now = this.clock.now();
        const tz = await this.tz();
        // Fire in the first 5 minutes after *household-local* midnight.
        if (minutesOfDayInTz(now, tz) < 5) {
          await this.runDayRollover(now, tz);
        }
      })();
    }, ONE_MINUTE_MS);
  }

  /**
   * Day-rollover work, run in the first few minutes after household-local
   * midnight. Two independent jobs (one failing must not starve the other):
   *
   * 1. Materialize the new household-local day's occurrences. Without this a
   *    long-running process never produces a new day's routine — occurrences
   *    only reappear on the next API restart or when an Admin saves a task,
   *    leaving the tablet's routine empty after midnight. See
   *    docs/engines/recurrence.md ("When occurrences materialize").
   * 2. Roll over the daily-routine streak for the day that just ended.
   *
   * Extracted from the timer so the path is unit-testable; the `setInterval`
   * in onModuleInit is not.
   */
  async runDayRollover(now: Date, tz: string): Promise<void> {
    await this.occurrences.generateForDate(now).catch((err) => {
      this.logger.warn(
        `day-rollover occurrence generation failed: ${err instanceof Error ? err.message : err}`,
      );
    });
    const yesterday = addDaysInTz(now, -1, tz);
    await this.dailyStreak.rolloverDay(yesterday).catch((err) => {
      this.logger.warn(
        `daily-streak rollover failed: ${err instanceof Error ? err.message : err}`,
      );
    });
  }

  onModuleDestroy(): void {
    if (this.missTimer) clearInterval(this.missTimer);
    if (this.rolloverTimer) clearInterval(this.rolloverTimer);
  }
}
