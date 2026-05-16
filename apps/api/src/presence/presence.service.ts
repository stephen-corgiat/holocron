import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  OneOffWindow,
  PresenceScheduleEntity,
  RecurringRuleKind,
} from './presence.entity';
import { UserEntity } from '../users/user.entity';
import {
  isHome as resolveIsHome,
  GridCells,
  PresenceScheduleLike,
} from './presence-resolver';
import { PresenceReconciliationService } from './presence-reconciliation.service';
import {
  DEFAULT_TIME_ZONE,
  HouseholdSettingsService,
} from '../household-settings/household-settings.service';

@Injectable()
export class PresenceService {
  constructor(
    @InjectRepository(PresenceScheduleEntity)
    private readonly schedules: Repository<PresenceScheduleEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly reconciliation: PresenceReconciliationService,
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

  private snapshot(row: PresenceScheduleEntity): PresenceScheduleLike {
    return {
      recurringRuleKind: row.recurringRuleKind,
      gridNWeeks: row.gridNWeeks,
      gridCells: row.gridCells,
      epochDate: row.epochDate,
      oneOffWindows: (row.oneOffWindows ?? []).map((w) => ({ ...w })),
    };
  }

  /**
   * Idempotently materialize a default presence schedule for a Trackee.
   * Defaults: `none` for admins, `full_time` for non-admin Restrictable
   * Trackees, `full_time` for everyone else (we err on the side of "track
   * presence" once the Trackee is tracked at all).
   */
  async ensureDefault(user: UserEntity): Promise<PresenceScheduleEntity> {
    const existing = await this.schedules.findOne({
      where: { userId: user.id },
    });
    if (existing) return existing;
    const kind: RecurringRuleKind = user.isAdmin ? 'none' : 'full_time';
    const entity = this.schedules.create({
      userId: user.id,
      recurringRuleKind: kind,
      oneOffWindows: [],
    });
    return this.schedules.save(entity);
  }

  /** All schedules, joined with their Trackee, for the admin Presence screen. */
  async listWithUsers(): Promise<
    Array<{ schedule: PresenceScheduleEntity; user: UserEntity }>
  > {
    const users = await this.users.find({
      where: { deactivatedAt: IsNull() },
      order: { isAdmin: 'ASC', createdAt: 'ASC' },
    });
    const out: Array<{ schedule: PresenceScheduleEntity; user: UserEntity }> = [];
    for (const u of users) {
      const schedule = await this.ensureDefault(u);
      out.push({ schedule, user: u });
    }
    return out;
  }

  async findByUserId(userId: string): Promise<PresenceScheduleEntity> {
    const row = await this.schedules.findOne({ where: { userId } });
    if (!row) throw new NotFoundException(`no presence schedule for ${userId}`);
    return row;
  }

  /**
   * Update the recurring-rule kind. Grid and one-off windows are edited
   * separately; this only sets the kind discriminator.
   */
  async setKind(
    userId: string,
    kind: RecurringRuleKind,
  ): Promise<PresenceScheduleEntity> {
    const row = await this.findByUserId(userId);
    const before = this.snapshot(row);
    row.recurringRuleKind = kind;
    const saved = await this.schedules.save(row);
    await this.reconciliation.reconcileForUser(userId, before, this.snapshot(saved));
    return saved;
  }

  /**
   * Whole-shape update used by the admin Presence editor — sets the kind
   * plus the grid columns atomically. Non-grid kinds clear the grid columns
   * so a later switch back to `n_week_grid` starts from a clean shape.
   */
  async update(
    userId: string,
    patch: {
      recurringRuleKind: RecurringRuleKind;
      gridNWeeks: number | null;
      epochDate: string | null;
      gridCells: GridCells | null;
    },
  ): Promise<PresenceScheduleEntity> {
    const row = await this.schedules.findOne({
      where: { userId },
      relations: { user: true },
    });
    if (!row) throw new NotFoundException(`no presence schedule for ${userId}`);
    const before = this.snapshot(row);
    row.recurringRuleKind = patch.recurringRuleKind;
    if (patch.recurringRuleKind === 'n_week_grid') {
      row.gridNWeeks = patch.gridNWeeks;
      row.epochDate = patch.epochDate;
      row.gridCells = patch.gridCells;
    } else {
      row.gridNWeeks = null;
      row.epochDate = null;
      row.gridCells = null;
    }
    const saved = await this.schedules.save(row);
    await this.reconciliation.reconcileForUser(userId, before, this.snapshot(saved));
    return saved;
  }

  /**
   * Append vacation windows to the Trackee's `one_off_windows` array.
   * Duplicates (by start+end+label) are silently de-duped.
   */
  async addVacationWindows(
    userId: string,
    incoming: OneOffWindow[],
  ): Promise<PresenceScheduleEntity> {
    const row = await this.findByUserId(userId);
    const before = this.snapshot(row);
    const existing = row.oneOffWindows ?? [];
    const merged = [...existing];
    for (const w of incoming) {
      const dup = merged.some(
        (e) => e.start === w.start && e.end === w.end && e.label === w.label,
      );
      if (!dup) merged.push(w);
    }
    // Sort ascending by start date for stable ordering.
    merged.sort((a, b) => a.start.localeCompare(b.start));
    row.oneOffWindows = merged;
    const saved = await this.schedules.save(row);
    await this.reconciliation.reconcileForUser(userId, before, this.snapshot(saved));
    return saved;
  }

  /** Replace the entire one_off_windows array (used by the delete-window flow). */
  async setVacationWindows(
    userId: string,
    windows: OneOffWindow[],
  ): Promise<PresenceScheduleEntity> {
    const row = await this.findByUserId(userId);
    const before = this.snapshot(row);
    row.oneOffWindows = [...windows].sort((a, b) =>
      a.start.localeCompare(b.start),
    );
    const saved = await this.schedules.save(row);
    await this.reconciliation.reconcileForUser(userId, before, this.snapshot(saved));
    return saved;
  }

  /** Convenience: query the resolver against the persisted schedule. */
  async isHome(userId: string, instant: Date): Promise<boolean> {
    const schedule = await this.findByUserId(userId);
    return resolveIsHome(schedule, instant, await this.tz());
  }
}
