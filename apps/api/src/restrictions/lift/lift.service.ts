import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { CLOCK, Clock } from '../../clock/clock';
import { RemediationRequestEntity } from '../remediation-request.entity';
import { RestrictionCauseEntity } from '../restriction-cause.entity';
import { RestrictionEnforcementService } from '../restriction-enforcement.service';
import {
  RestrictionCauseInput,
  RestrictionScope,
  recompute,
} from '../restriction-merge';
import { RestrictionEntity } from '../restriction.entity';
import { RealtimeBus } from '../../realtime/realtime-bus';
import {
  ApplyLiftInput,
  CauseFilter,
  LiftMechanism,
  LiftResult,
} from './lift.types';

/**
 * Lift module (GLOSSARY — Lift mechanism). Owns the cause-remove → recompute →
 * lift-if-empty dance that used to be duplicated across three methods on
 * `RestrictionsService` (`liftEarly`, `sweepExpired`, `removeCausesByOccurrence`)
 * and reached into from `goals.service.ts`.
 *
 * Two entry points:
 *
 * - `applyLift({ mechanism, filter })` — canonical Lift mechanism path.
 *   Records the mechanism in the log line; otherwise identical DB effects to
 *   `removeCauses`.
 *
 * - `removeCauses(filter)` — primitive used by callers that don't claim a
 *   canonical mechanism (e.g. presence reconciliation flipping a past
 *   occurrence to suppressed; not currently wired but the seam is here).
 *
 * Both paths: in one DB transaction, delete matching Causes, recompute each
 * affected Restriction, and if the Cause list emptied set `lifted_at` +
 * resolve any open RemediationRequests. After commit: emit
 * `restrictions:changed` per touched user and best-effort deactivate
 * enforcement per lifted Restriction (network call to router/PiHole — not
 * rolled back on failure, matches the prior pattern in `liftEarly`).
 *
 * Cause *creation* (`applyMissCause`, `applyAdminCause`) stays on
 * `RestrictionsService` — not in Lift's scope.
 */
@Injectable()
export class LiftService {
  private readonly logger = new Logger('LiftService');

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(RestrictionEntity)
    private readonly restrictions: Repository<RestrictionEntity>,
    @InjectRepository(RestrictionCauseEntity)
    private readonly causes: Repository<RestrictionCauseEntity>,
    @InjectRepository(RemediationRequestEntity)
    private readonly remediationRequests: Repository<RemediationRequestEntity>,
    private readonly bus: RealtimeBus,
    private readonly enforcement: RestrictionEnforcementService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async applyLift(input: ApplyLiftInput): Promise<LiftResult> {
    return this.remove(input.filter, input.mechanism);
  }

  async removeCauses(filter: CauseFilter): Promise<LiftResult> {
    return this.remove(filter, null);
  }

  private async remove(
    filter: CauseFilter,
    mechanism: LiftMechanism | null,
  ): Promise<LiftResult> {
    const causeRows = await this.resolveTargetCauses(filter);
    const affectedRestrictionIds = new Set(causeRows.map((c) => c.restrictionId));
    if (affectedRestrictionIds.size === 0) {
      return { touchedRestrictionIds: [], liftedRestrictionIds: [] };
    }

    const userIdsTouched = new Set<string>();
    const lifted: Array<{
      userId: string;
      scope: RestrictionScope;
      restrictionId: string;
    }> = [];

    await this.dataSource.transaction(async (trx) => {
      const causeRepo = trx.getRepository(RestrictionCauseEntity);
      const restrictionRepo = trx.getRepository(RestrictionEntity);
      const reqRepo = trx.getRepository(RemediationRequestEntity);

      await causeRepo.delete(causeRows.map((c) => c.id));

      for (const rid of affectedRestrictionIds) {
        const r = await restrictionRepo.findOne({
          where: { id: rid },
          relations: { causes: true },
        });
        if (!r) continue;
        userIdsTouched.add(r.userId);

        const remaining = r.causes.map(toCauseInput);
        const recomputed = recompute(r.scope, r.userId, remaining);
        if (!recomputed) {
          const now = this.clock.now();
          await restrictionRepo.update(
            { id: rid },
            {
              effectiveExpiresAt: null,
              effectiveRemediationGoals: [],
              liftedAt: now,
            },
          );
          await reqRepo.update(
            { restrictionId: rid, status: 'open' },
            { status: 'resolved', resolvedAt: now },
          );
          lifted.push({ userId: r.userId, scope: r.scope, restrictionId: rid });
        } else {
          await restrictionRepo.update(
            { id: rid },
            {
              effectiveExpiresAt: recomputed.effective_expires_at,
              effectiveRemediationGoals: recomputed.effective_remediation_goals,
            },
          );
        }
      }
    });

    for (const uid of userIdsTouched) this.bus.emit({ kind: 'restrictions:changed', userId: uid });
    for (const item of lifted) {
      await this.enforcement.deactivate(
        item.userId,
        item.scope,
        item.restrictionId,
      );
    }

    if (mechanism) {
      this.logger.log(
        `lifted mechanism=${mechanism} touched=${userIdsTouched.size} lifted_restrictions=${lifted.length}`,
      );
    }

    return {
      touchedRestrictionIds: Array.from(affectedRestrictionIds),
      liftedRestrictionIds: lifted.map((l) => l.restrictionId),
    };
  }

  /**
   * Resolve the filter to the concrete set of Cause rows to delete. For
   * `all_for_restriction`, throws if the Restriction doesn't exist or is
   * already lifted — that filter expresses an explicit lift intent; silent
   * no-op would hide bugs. For the others (which may legitimately match
   * zero), returns an empty list.
   */
  private async resolveTargetCauses(
    filter: CauseFilter,
  ): Promise<RestrictionCauseEntity[]> {
    if (filter.kind === 'all_for_restriction') {
      const r = await this.restrictions.findOne({
        where: { id: filter.restrictionId, liftedAt: IsNull() },
      });
      if (!r) {
        throw new NotFoundException(
          `restriction ${filter.restrictionId} not found or already lifted`,
        );
      }
      return this.causes.find({ where: { restrictionId: filter.restrictionId } });
    }
    if (filter.kind === 'by_occurrence') {
      return this.causes.find({ where: { occurrenceId: filter.occurrenceId } });
    }
    if (filter.causeIds.length === 0) return [];
    return this.causes.find({ where: { id: In(filter.causeIds) } });
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
