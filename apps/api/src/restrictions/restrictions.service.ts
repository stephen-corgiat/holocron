import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { CLOCK, Clock } from '../clock/clock';
import { UserEntity } from '../users/user.entity';
import { OccurrenceEntity } from '../tasks/occurrence.entity';
import { RestrictionEntity } from './restriction.entity';
import { RestrictionCauseEntity } from './restriction-cause.entity';
import { RemediationRequestEntity } from './remediation-request.entity';
import { RealtimeBus } from '../realtime/realtime-bus';
import { RestrictionEnforcementService } from './restriction-enforcement.service';
import { LiftService } from './lift';
import {
  CauseKind,
  RestrictionCauseInput,
  RestrictionScope,
  mergeCause,
} from './restriction-merge';
import {
  ActiveRestrictionByScope,
  EnforcementLogView,
  RemediationRequestView,
  RestrictionCauseView,
  RestrictionView,
  RestrictionsOverviewResponse,
  SCOPES,
  ScopeSummary,
  TabletRestrictionView,
  UserHasActiveRestriction,
} from './dto';
import { EnforcementLogEntity } from './enforcement-log.entity';

export interface MissCauseInput {
  user_id: string;
  scope: RestrictionScope;
  occurrence_id: string;
  contributed_expires_at: Date | null;
  contributed_remediation_goals: string[] | null;
  parent_only_on_expiry: boolean;
  parent_only_on_remediation: boolean;
}

export interface AdminCauseInput {
  user_id: string;
  scope: RestrictionScope;
  admin_user_id: string;
  reason: string | null;
}

/**
 * Side-effecting wrapper around the pure merge engine. Persists Restrictions
 * and Causes, recomputes `effective_*` columns on Cause creation, and emits
 * `restrictions:changed` for the realtime gateway. Cause *removal* (and the
 * cascade into recompute / lift / RemediationRequest resolution / enforcement
 * deactivation) lives in `LiftService` — this service's `liftEarly` and
 * `sweepExpired` are thin delegators.
 *
 * "Block now" and the Miss-engine integration funnel through `applyCause`.
 */
@Injectable()
export class RestrictionsService {
  private readonly logger = new Logger('RestrictionsService');

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(RestrictionEntity)
    private readonly restrictions: Repository<RestrictionEntity>,
    @InjectRepository(RestrictionCauseEntity)
    private readonly causes: Repository<RestrictionCauseEntity>,
    @InjectRepository(RemediationRequestEntity)
    private readonly remediationRequests: Repository<RemediationRequestEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly bus: RealtimeBus,
    private readonly enforcement: RestrictionEnforcementService,
    private readonly lift: LiftService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Apply a MissCause to (user, scope). Called by the Miss-engine when a
   * tier's restriction spec fires on a Restrictable Trackee.
   */
  async applyMissCause(input: MissCauseInput): Promise<RestrictionEntity> {
    return this.applyCause(input.user_id, input.scope, {
      kind: 'miss',
      occurrence_id: input.occurrence_id,
      admin_user_id: null,
      reason: null,
      contributed_expires_at: input.contributed_expires_at,
      contributed_remediation_goals: input.contributed_remediation_goals,
      parent_only_on_expiry: input.parent_only_on_expiry,
      parent_only_on_remediation: input.parent_only_on_remediation,
    });
  }

  /**
   * Apply an AdminCause via "Block now". Always parent-only on both
   * dimensions per ADR-0004 — the admin-override bite.
   */
  async applyAdminCause(input: AdminCauseInput): Promise<RestrictionEntity> {
    return this.applyCause(input.user_id, input.scope, {
      kind: 'admin',
      occurrence_id: null,
      admin_user_id: input.admin_user_id,
      reason: input.reason,
      contributed_expires_at: null,
      contributed_remediation_goals: null,
      parent_only_on_expiry: true,
      parent_only_on_remediation: true,
    });
  }

  /**
   * Wait-out sweep — for each active Restriction whose
   * `effective_expires_at` has passed, delegate to `LiftService` with the
   * `auto_expiry` mechanism. Per-lift failures are swallowed (logged) so one
   * stuck Restriction doesn't poison the rest of the tick.
   */
  async sweepExpired(now: Date = this.clock.now()): Promise<number> {
    const due = await this.restrictions.find({
      where: {
        liftedAt: IsNull(),
        effectiveExpiresAt: LessThanOrEqual(now),
      },
    });
    if (due.length === 0) return 0;
    for (const r of due) {
      try {
        await this.lift.applyLift({
          mechanism: 'auto_expiry',
          filter: { kind: 'all_for_restriction', restrictionId: r.id },
        });
      } catch (err) {
        this.logger.warn(
          `sweep failed for restriction=${r.id}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
    this.logger.log(`wait-out sweep lifted ${due.length} restriction(s)`);
    return due.length;
  }

  /**
   * Admin "Lift early" — delegates to `LiftService` with the `admin`
   * mechanism. The 404 path (restriction not found / already lifted) is
   * preserved by `LiftService.applyLift` for the `all_for_restriction`
   * filter.
   */
  async liftEarly(restrictionId: string): Promise<void> {
    await this.lift.applyLift({
      mechanism: 'admin',
      filter: { kind: 'all_for_restriction', restrictionId },
    });
  }

  async createRemediationRequest(input: {
    user_id: string;
    scope: RestrictionScope;
    note: string | null;
  }): Promise<RemediationRequestEntity> {
    const active = await this.restrictions.findOne({
      where: {
        userId: input.user_id,
        scope: input.scope,
        liftedAt: IsNull(),
      },
    });
    if (!active) {
      throw new BadRequestException(
        `no active restriction for user=${input.user_id} scope=${input.scope}`,
      );
    }
    const row = await this.remediationRequests.save(
      this.remediationRequests.create({
        userId: input.user_id,
        restrictionId: active.id,
        scope: input.scope,
        note: input.note,
        status: 'open',
      }),
    );
    this.bus.emit({ kind: 'restrictions:changed', userId: input.user_id });
    return row;
  }

  async listOpenRemediationRequests(): Promise<RemediationRequestView[]> {
    const rows = await this.remediationRequests.find({
      where: { status: 'open' },
      relations: { user: true },
      order: { createdAt: 'ASC' },
    });
    return rows.map((r) => ({
      id: r.id,
      user_id: r.userId,
      user_display_name: r.user?.displayName ?? '',
      restriction_id: r.restrictionId,
      scope: r.scope,
      note: r.note,
      created_at: r.createdAt.toISOString(),
    }));
  }

  async resolveRemediationRequest(id: string): Promise<void> {
    const row = await this.remediationRequests.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`request ${id} not found`);
    if (row.status === 'resolved') return;
    row.status = 'resolved';
    row.resolvedAt = this.clock.now();
    await this.remediationRequests.save(row);
    this.bus.emit({ kind: 'restrictions:changed', userId: row.userId });
  }

  async overview(): Promise<RestrictionsOverviewResponse> {
    const [active, restrictable, remediation_requests, enforcement_log] =
      await Promise.all([
        this.restrictions.find({
          where: { liftedAt: IsNull() },
          relations: { causes: { occurrence: { task: true } }, user: true },
          order: { createdAt: 'DESC' },
        }),
        this.users.find({
          where: { isRestrictable: true, deactivatedAt: IsNull() },
        }),
        this.listOpenRemediationRequests(),
        this.enforcement.recentLog(100),
      ]);

    const totalRestrictable = restrictable.length;
    const scopes: ScopeSummary[] = SCOPES.map((scope) => ({
      scope,
      blocked_user_ids: active
        .filter((r) => r.scope === scope)
        .map((r) => r.userId),
      total_restrictable: totalRestrictable,
    }));

    const activeViews: RestrictionView[] = active.map((r) =>
      toRestrictionView(r),
    );

    return {
      scopes,
      active: activeViews,
      remediation_requests,
      enforcement_log: enforcement_log.map(toEnforcementLogView),
    };
  }

  /** Tablet-side: every active Restriction for a single Trackee. */
  async forTrackee(userId: string): Promise<TabletRestrictionView> {
    const rows = await this.restrictions.find({
      where: { userId, liftedAt: IsNull() },
      relations: { causes: { occurrence: { task: true } } },
      order: { createdAt: 'ASC' },
    });
    const active: ActiveRestrictionByScope[] = rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      effective_expires_at: r.effectiveExpiresAt?.toISOString() ?? null,
      effective_remediation_goals: r.effectiveRemediationGoals,
      causes: r.causes
        .slice()
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(toCauseView),
    }));
    return { user_id: userId, active };
  }

  /** Lightweight: which Trackees currently have any active Restriction? */
  async listUsersWithActive(): Promise<UserHasActiveRestriction[]> {
    const rows = await this.restrictions
      .createQueryBuilder('r')
      .select('DISTINCT r.user_id', 'user_id')
      .where('r.lifted_at IS NULL')
      .getRawMany<{ user_id: string }>();
    const set = new Set(rows.map((r) => r.user_id));
    return Array.from(set).map((user_id) => ({
      user_id,
      has_active: true,
    }));
  }

  private async applyCause(
    userId: string,
    scope: RestrictionScope,
    cause: {
      kind: CauseKind;
      occurrence_id: string | null;
      admin_user_id: string | null;
      reason: string | null;
      contributed_expires_at: Date | null;
      contributed_remediation_goals: string[] | null;
      parent_only_on_expiry: boolean;
      parent_only_on_remediation: boolean;
    },
  ): Promise<RestrictionEntity> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException(`user ${userId} not found`);
    }
    let wasActivated = false;
    const result = await this.dataSource.transaction(async (trx) => {
      const rRepo = trx.getRepository(RestrictionEntity);
      const cRepo = trx.getRepository(RestrictionCauseEntity);

      let restriction = await rRepo.findOne({
        where: { userId, scope, liftedAt: IsNull() },
        relations: { causes: true },
      });
      if (!restriction) {
        restriction = rRepo.create({
          userId,
          scope,
          effectiveExpiresAt: null,
          effectiveRemediationGoals: [],
          liftedAt: null,
          causes: [],
        });
        restriction = await rRepo.save(restriction);
        restriction.causes = [];
        wasActivated = true;
      }

      const causeRow = cRepo.create({
        restrictionId: restriction.id,
        kind: cause.kind,
        occurrenceId: cause.occurrence_id,
        adminUserId: cause.admin_user_id,
        reason: cause.reason,
        contributedExpiresAt: cause.contributed_expires_at,
        contributedRemediationGoals: cause.contributed_remediation_goals,
        parentOnlyOnExpiry: cause.parent_only_on_expiry,
        parentOnlyOnRemediation: cause.parent_only_on_remediation,
      });
      const savedCause = await cRepo.save(causeRow);

      const priorState =
        restriction.causes.length === 0
          ? null
          : {
              scope,
              user_id: userId,
              causes: restriction.causes.map(toCauseInput),
              effective_expires_at: restriction.effectiveExpiresAt,
              effective_remediation_goals:
                restriction.effectiveRemediationGoals,
            };
      const recomputed = mergeCause(
        priorState,
        userId,
        scope,
        toCauseInput(savedCause),
      );

      await rRepo.update(
        { id: restriction.id },
        {
          effectiveExpiresAt: recomputed.effective_expires_at,
          effectiveRemediationGoals: recomputed.effective_remediation_goals,
        },
      );

      this.bus.emit({ kind: 'restrictions:changed', userId: userId });
      this.logger.log(
        `cause appended user=${userId} scope=${scope} kind=${cause.kind} restriction=${restriction.id}`,
      );

      return (await rRepo.findOne({
        where: { id: restriction.id },
        relations: { causes: true },
      }))!;
    });

    if (wasActivated) {
      await this.enforcement.activate(userId, scope, result.id);
    }
    return result;
  }
}

function toCauseInput(row: RestrictionCauseEntity): RestrictionCauseInput {
  return {
    id: row.id,
    kind: row.kind,
    contributed_expires_at: row.contributedExpiresAt,
    contributed_remediation_goals: row.contributedRemediationGoals,
    parent_only_on_expiry: row.parentOnlyOnExpiry,
    parent_only_on_remediation: row.parentOnlyOnRemediation,
  };
}

function toCauseView(row: RestrictionCauseEntity): RestrictionCauseView {
  return {
    id: row.id,
    kind: row.kind,
    occurrence_id: row.occurrenceId,
    admin_user_id: row.adminUserId,
    reason: row.reason,
    contributed_expires_at: row.contributedExpiresAt?.toISOString() ?? null,
    contributed_remediation_goals: row.contributedRemediationGoals,
    parent_only_on_expiry: row.parentOnlyOnExpiry,
    parent_only_on_remediation: row.parentOnlyOnRemediation,
    created_at: row.createdAt.toISOString(),
    occurrence_task_name: row.occurrence?.task?.name ?? null,
  };
}

function toEnforcementLogView(row: EnforcementLogEntity): EnforcementLogView {
  return {
    id: row.id,
    restriction_id: row.restrictionId,
    user_id: row.userId,
    backend: row.backend,
    scope: row.scope,
    action: row.action,
    target_address: row.targetAddress,
    result: row.result,
    http_status: row.httpStatus,
    error: row.error,
    created_at: row.createdAt.toISOString(),
  };
}

function toRestrictionView(row: RestrictionEntity): RestrictionView {
  return {
    id: row.id,
    user_id: row.userId,
    user_display_name: row.user?.displayName ?? '',
    scope: row.scope,
    effective_expires_at: row.effectiveExpiresAt?.toISOString() ?? null,
    effective_remediation_goals: row.effectiveRemediationGoals,
    created_at: row.createdAt.toISOString(),
    causes: (row.causes ?? [])
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(toCauseView),
  };
}
