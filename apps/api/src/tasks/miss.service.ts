import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OccurrenceEntity } from './occurrence.entity';
import { RealtimeBus } from '../realtime/realtime-bus';
import { PresenceService } from '../presence/presence.service';
import { isSuppressed } from '../presence/presence-resolver';
import { ResolutionService } from './resolution';
import {
  DEFAULT_TIME_ZONE,
  HouseholdSettingsService,
} from '../household-settings/household-settings.service';

/**
 * Deadline-tick orchestrator. Finds active occurrences whose deadline has
 * passed and dispatches each through `ResolutionService` with intent
 * `evaluate_deadline` — the Resolution engine runs the (now co-located)
 * Miss-engine and applies the four-effect tuple when it returns `MissFired`.
 *
 * This service owns no business logic of its own beyond candidate discovery
 * and the per-Trackee Presence-schedule cache used during a sweep.
 */
@Injectable()
export class MissService {
  private readonly logger = new Logger('MissService');

  constructor(
    @InjectRepository(OccurrenceEntity)
    private readonly occurrences: Repository<OccurrenceEntity>,
    private readonly bus: RealtimeBus,
    @Inject(forwardRef(() => PresenceService))
    private readonly presence: PresenceService,
    @Inject(forwardRef(() => ResolutionService))
    private readonly resolution: ResolutionService,
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
   * Sweep active occurrences whose deadline is ≤ now and run the
   * Resolution engine for each. Idempotent: occurrences flip to `missed`
   * and are excluded from the next sweep.
   *
   * Deadline rule (per task kind):
   *   - recurring: `scheduled_at`.
   *   - windowed:  `window_end` (GLOSSARY.md §Windowed task).
   */
  async fireDeadlineTick(now: Date): Promise<{ fired: number }> {
    const candidates = await this.occurrences
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.task', 't')
      .leftJoinAndSelect('o.user', 'u')
      .where("o.status = 'active'")
      .andWhere(
        '((o.window_end IS NULL AND o.scheduled_at <= :now) OR (o.window_end IS NOT NULL AND o.window_end <= :now))',
        { now },
      )
      .getMany();

    let fired = 0;
    const tz = await this.tz();
    const scheduleCache = new Map<string, Awaited<ReturnType<PresenceService['findByUserId']>> | null>();
    for (const occ of candidates) {
      if (!occ.task) continue;
      if (occ.task.kind !== 'recurring' && occ.task.kind !== 'windowed') {
        continue;
      }
      const deadline =
        occ.task.kind === 'windowed' && occ.windowEnd
          ? occ.windowEnd
          : occ.scheduledAt;

      // Derive suppression on read (ADR-0003). Schedules cached per sweep
      // so we don't re-query for every occurrence of the same Trackee.
      let schedule = scheduleCache.get(occ.userId);
      if (schedule === undefined) {
        schedule = await this.presence
          .findByUserId(occ.userId)
          .catch(() => null);
        scheduleCache.set(occ.userId, schedule);
      }
      const presenceSuppressed = schedule
        ? isSuppressed(schedule, deadline, tz)
        : false;

      const { result } = await this.resolution.apply(occ.id, {
        kind: 'evaluate_deadline',
        isRestrictable: occ.user?.isRestrictable ?? false,
        presenceSuppressed,
      });
      if (result.kind === 'effects') fired += 1;
    }

    if (fired > 0) {
      this.logger.log(`fired ${fired} miss(es)`);
      this.bus.emit({ kind: 'tasks:changed' });
    }
    return { fired };
  }
}
