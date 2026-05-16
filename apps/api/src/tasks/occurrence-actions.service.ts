import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OccurrenceEntity } from './occurrence.entity';
import { TaskEntity } from './task.entity';
import { combineDateAndDueTime } from './occurrences.service';
import {
  DEFAULT_TIME_ZONE,
  HouseholdSettingsService,
} from '../household-settings/household-settings.service';
import { ResolutionService } from './resolution';

/**
 * Per-occurrence admin actions: Excuse, Defer, Late completion. All three
 * delegate to `ResolutionService` — this service owns no side-effect logic
 * of its own anymore, only DTO shaping (combining the deferToDate + task
 * dueTime for Defer) and the post-call structured logging.
 */
@Injectable()
export class OccurrenceActionsService {
  private readonly logger = new Logger('OccurrenceActionsService');

  constructor(
    @InjectRepository(OccurrenceEntity)
    private readonly occurrences: Repository<OccurrenceEntity>,
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

  async excuse(
    occurrenceId: string,
    adminUserId: string | null,
  ): Promise<OccurrenceEntity> {
    const { occurrence, result } = await this.resolution.apply(occurrenceId, {
      kind: 'excuse',
      adminUserId,
    });
    if (result.kind === 'effects') {
      this.logger.log(
        `excused occurrence=${occurrence.id} by ${adminUserId ?? 'system'}`,
      );
    }
    return occurrence;
  }

  async defer(
    occurrenceId: string,
    deferToDate: Date,
    adminUserId: string | null,
  ): Promise<{
    original: OccurrenceEntity;
    deferred: OccurrenceEntity;
  }> {
    // The applier resolves the occurrence + task as part of snapshot load;
    // we still need the task's due_time to combine with the deferToDate, so
    // peek at it here. (Snapshot-derived combine is a future tightening.)
    const occ = await this.loadActionable(occurrenceId);
    const tz = await this.tz();
    const targetScheduledAt = combineDateAndDueTime(
      deferToDate,
      occ.task.dueTime,
      tz,
    );

    const { occurrence, newOccurrenceId } = await this.resolution.apply(
      occurrenceId,
      {
        kind: 'defer',
        adminUserId,
        deferredScheduledAt: targetScheduledAt,
      },
    );
    if (!newOccurrenceId) {
      throw new BadRequestException(
        `defer did not spawn a new occurrence for ${occurrenceId}`,
      );
    }
    this.logger.log(
      `deferred occurrence=${occurrence.id} -> ${newOccurrenceId} (${targetScheduledAt.toISOString()}) by ${
        adminUserId ?? 'system'
      }`,
    );
    const deferred = await this.resolution.getOccurrence(newOccurrenceId);
    return {
      original: occurrence,
      deferred: deferred ?? ({} as OccurrenceEntity),
    };
  }

  /**
   * Late completion of a missed occurrence (ADR-0001). All four Miss effects
   * undo: penalty refunded (`claw_back`), ladder advance retracted, Restriction
   * Cause removed, and the broken streak day is re-counted
   * as Clean — the occurrence flips to `complete` so day-rollover classifyDay
   * reads it as a positive resolution and the Clean streak counter advances.
   *
   * Guards: task.allow_late_completion must be true, and `now` must fall
   * within `scheduled_at + late_window_minutes`.
   */
  async lateComplete(occurrenceId: string): Promise<OccurrenceEntity> {
    const { occurrence } = await this.resolution.apply(occurrenceId, {
      kind: 'late_complete',
    });
    this.logger.log(`late-completed occurrence=${occurrence.id}`);
    return occurrence;
  }

  private async loadActionable(
    occurrenceId: string,
  ): Promise<OccurrenceEntity & { task: TaskEntity }> {
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
    return occ as OccurrenceEntity & { task: TaskEntity };
  }
}
