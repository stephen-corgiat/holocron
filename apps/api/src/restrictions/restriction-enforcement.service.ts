import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EnforcementLogEntity } from './enforcement-log.entity';
import {
  RESTRICTION_BACKEND_PIHOLE,
  RESTRICTION_BACKEND_ROUTER,
  RestrictionBackend,
} from './restriction-backend';
import { RestrictionScope } from './restriction-merge';

/**
 * Scope-to-backend dispatcher. `RestrictionsService` calls only the dispatcher
 * and never names a backend directly. The mapping is fixed at boot:
 *
 *   internet      → router (EdgeRouter ipset)
 *   entertainment → PiHole  (DNS blocklist group)
 *   games         → PiHole  (DNS blocklist group)
 *
 * Both backends write to the same `enforcement_log` table; `recentLog` is the
 * unified query the admin dashboard consumes.
 */
@Injectable()
export class RestrictionEnforcementService implements RestrictionBackend {
  private readonly backends: Record<RestrictionScope, RestrictionBackend>;

  constructor(
    @Inject(RESTRICTION_BACKEND_ROUTER)
    routerBackend: RestrictionBackend,
    @Inject(RESTRICTION_BACKEND_PIHOLE)
    piholeBackend: RestrictionBackend,
    @InjectRepository(EnforcementLogEntity)
    private readonly enforcementLog: Repository<EnforcementLogEntity>,
  ) {
    this.backends = {
      internet: routerBackend,
      entertainment: piholeBackend,
      games: piholeBackend,
    };
  }

  async activate(
    userId: string,
    scope: RestrictionScope,
    restrictionId: string,
  ): Promise<void> {
    await this.backends[scope].activate(userId, scope, restrictionId);
  }

  async deactivate(
    userId: string,
    scope: RestrictionScope,
    restrictionId: string | null,
  ): Promise<void> {
    await this.backends[scope].deactivate(userId, scope, restrictionId);
  }

  /** Unified enforcement log feed for the admin dashboard. */
  async recentLog(limit = 100): Promise<EnforcementLogEntity[]> {
    return this.enforcementLog.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
