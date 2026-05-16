import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { OccurrenceEntity } from '../tasks/occurrence.entity';
import { UserEntity } from '../users/user.entity';
import {
  DEFAULT_TIME_ZONE,
  HouseholdSettingsService,
} from '../household-settings/household-settings.service';
import { PresenceService } from '../presence/presence.service';
import { isSuppressed } from '../presence/presence-resolver';
import { CLOCK, Clock } from '../clock/clock';
import { RealtimeBus } from '../realtime/realtime-bus';
import { isoDateInTz, minutesOfDayInTz } from '../clock/tz';

/**
 * Audible warning.
 *
 * A single household-level chime + visual cue that fires on the wall tablet
 * at a configured HH:MM, when at least one Restrictable Trackee still has an
 * actionable non-reminder occurrence. Parents' tasks never trigger; presence-
 * suppressed and Excused / Deferred / Pending review occurrences are
 * excluded. At most once per household-day.
 */
@Injectable()
export class AudibleWarningService {
  private readonly logger = new Logger('AudibleWarningService');

  constructor(
    @InjectRepository(OccurrenceEntity)
    private readonly occurrences: Repository<OccurrenceEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly settings: HouseholdSettingsService,
    private readonly presence: PresenceService,
    private readonly bus: RealtimeBus,
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
   * Scheduler entrypoint. Should be called once per minute. Returns true
   * if the warning was fired this tick.
   */
  async tick(now: Date = this.clock.now()): Promise<boolean> {
    const at = await this.settings.audibleWarningAt();
    if (!at) return false;
    const tz = await this.tz();
    if (!isAtOrPast(at, now, tz)) return false;

    const today = isoDateInTz(now, tz);
    const lastFired = await this.settings.audibleWarningLastFiredOn();
    if (lastFired === today) return false;

    const shouldFire = await this.shouldFire(now, tz);
    if (!shouldFire) return false;

    await this.settings.markAudibleWarningFired(today);
    this.bus.emit({ kind: 'audible_warning:fire', at: now });
    this.logger.log(`audible warning fired at ${now.toISOString()}`);
    return true;
  }

  /**
   * Pure evaluation: does at least one Restrictable Trackee have an
   * actionable non-reminder, non-presence-suppressed, non-Excused/Deferred/
   * Pending-review occurrence right now?
   */
  async shouldFire(now: Date, tz: string): Promise<boolean> {
    const restrictable = await this.users.find({
      where: { isRestrictable: true, isAdmin: false, deactivatedAt: IsNull() },
    });
    if (restrictable.length === 0) return false;

    for (const u of restrictable) {
      const rows = await this.occurrences
        .createQueryBuilder('o')
        .leftJoinAndSelect('o.task', 't')
        .where('o.user_id = :userId', { userId: u.id })
        .andWhere("o.status = 'active'")
        .andWhere("t.kind <> 'reminder'")
        .getMany();
      if (rows.length === 0) continue;
      const schedule = await this.presence.findByUserId(u.id).catch(() => null);
      const stillActionable = rows.some((o) => {
        if (!o.task) return false;
        if (schedule && isSuppressed(schedule, o.scheduledAt, tz)) return false;
        return true;
      });
      if (stillActionable) return true;
    }
    return false;
  }
}

/** Has household-local wall-clock reached the configured HH:MM today? */
function isAtOrPast(hhmm: string, now: Date, tz: string): boolean {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return false;
  const targetMin = Number(m[1]) * 60 + Number(m[2]);
  return minutesOfDayInTz(now, tz) >= targetMin;
}
