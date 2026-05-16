import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { CLOCK, Clock } from '../clock/clock';
import { OccurrenceEntity } from '../tasks/occurrence.entity';
import { TaskEntity } from '../tasks/task.entity';
import { UserEntity } from '../users/user.entity';
import { ResolutionService } from '../tasks/resolution';
import { HouseholdSettingsService } from '../household-settings/household-settings.service';

export interface PendingCard {
  occurrence_id: string;
  task_id: string;
  task_name: string;
  task_icon: string | null;
  task_points: number;
  user_id: string;
  user_display_name: string;
  scheduled_at: string;
  pending_since: string;
}

/**
 * Pending review state machine (ADR-0002):
 *   approve → status='complete', no further ledger action (earn was posted
 *     optimistically on markComplete).
 *   reject  → status='missed', insert claw_back refunding the earn, then run
 *     the Miss-engine effects under a shared txn_group_id. Identical effects
 *     whether the rejection is admin-driven or sweep-driven.
 */
@Injectable()
export class PendingReviewService {
  private readonly logger = new Logger('PendingReviewService');

  constructor(
    @InjectRepository(OccurrenceEntity)
    private readonly occurrences: Repository<OccurrenceEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly resolution: ResolutionService,
    private readonly settings: HouseholdSettingsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(): Promise<PendingCard[]> {
    const rows = await this.occurrences.find({
      where: { status: 'pending_review' },
      relations: { task: true, user: true },
      order: { pendingSince: 'ASC' },
    });
    return rows
      .filter((r) => r.task && r.user)
      .map((r) => ({
        occurrence_id: r.id,
        task_id: r.taskId,
        task_name: r.task.name,
        task_icon: r.task.icon,
        task_points: r.task.points,
        user_id: r.userId,
        user_display_name: r.user.displayName,
        scheduled_at: r.scheduledAt.toISOString(),
        pending_since: (r.pendingSince ?? r.scheduledAt).toISOString(),
      }));
  }

  async approve(
    occurrenceId: string,
    adminUserId: string,
  ): Promise<OccurrenceEntity> {
    const { occurrence } = await this.resolution.apply(occurrenceId, {
      kind: 'approve_review',
      adminUserId,
    });
    this.logger.log(`approved occurrence=${occurrence.id} by admin=${adminUserId}`);
    return occurrence;
  }

  async approveAll(adminUserId: string): Promise<{ approved: number }> {
    const rows = await this.occurrences.find({
      where: { status: 'pending_review' },
    });
    let approved = 0;
    for (const row of rows) {
      try {
        await this.approve(row.id, adminUserId);
        approved += 1;
      } catch (err) {
        this.logger.warn(
          `approveAll: ${row.id} failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return { approved };
  }

  /**
   * Admin or sweep rejection. Atomically claws back the optimistic earn and
   * fires the Miss with all four effects, tagged with one `txn_group_id`.
   * Passing `adminUserId = null` indicates the timeout sweeper.
   */
  async reject(
    occurrenceId: string,
    adminUserId: string | null,
  ): Promise<OccurrenceEntity> {
    const occ = await this.loadPending(occurrenceId);
    const user = await this.users.findOne({ where: { id: occ.userId } });
    if (!user) {
      throw new BadRequestException(`user ${occ.userId} not found`);
    }
    const { occurrence } = await this.resolution.apply(occurrenceId, {
      kind: 'reject_review',
      adminUserId,
      isRestrictable: user.isRestrictable === true,
    });
    this.logger.log(
      `rejected occurrence=${occurrence.id} by ${adminUserId ?? 'sweep'}`,
    );
    return occurrence;
  }

  /** Sweep auto-rejection: any pending occurrence past timeout → reject(null). */
  async sweep(now: Date = this.clock.now()): Promise<{ rejected: number }> {
    const timeoutMs = await this.settings.pendingReviewTimeoutMs();
    const cutoff = new Date(now.getTime() - timeoutMs);
    const rows = await this.occurrences.find({
      where: {
        status: 'pending_review',
        pendingSince: LessThan(cutoff),
      },
    });
    let rejected = 0;
    for (const row of rows) {
      try {
        await this.reject(row.id, null);
        rejected += 1;
      } catch (err) {
        this.logger.warn(
          `sweep: ${row.id} failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    if (rejected > 0) {
      this.logger.log(`sweep auto-rejected ${rejected} occurrence(s)`);
    }
    return { rejected };
  }

  private async loadPending(
    occurrenceId: string,
  ): Promise<OccurrenceEntity & { task: TaskEntity }> {
    const occ = await this.occurrences.findOne({
      where: { id: occurrenceId },
      relations: { task: true },
    });
    if (!occ) {
      throw new NotFoundException(`occurrence ${occurrenceId} not found`);
    }
    if (occ.status !== 'pending_review') {
      throw new BadRequestException(
        `occurrence ${occurrenceId} is not in pending_review (status=${occ.status})`,
      );
    }
    if (!occ.task) {
      throw new BadRequestException(
        `occurrence ${occurrenceId} has no associated task`,
      );
    }
    return occ as OccurrenceEntity & { task: TaskEntity };
  }
}
