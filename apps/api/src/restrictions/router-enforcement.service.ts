import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeviceEntity } from '../users/device.entity';
import {
  EnforcementAction,
  EnforcementLogEntity,
  EnforcementResult,
} from './enforcement-log.entity';
import { RestrictionBackend } from './restriction-backend';
import { RestrictionScope } from './restriction-merge';
import {
  ROUTER_ENFORCEMENT_CONFIG,
  ROUTER_HTTP_CLIENT,
  RouterEnforcementConfig,
  RouterHttpClient,
} from './router-enforcement';

interface AdapterCallContext {
  restrictionId: string | null;
  userId: string;
}

/**
 * Deep module that wraps the EdgeRouter HTTP service. The router exposes
 * per-scope ipset endpoints that accept a comma-separated `ip=<csv>` list,
 * so one HTTP call covers all of a Trackee's IP-bearing Devices.
 *
 * `activate` = `add` (IPs go into the scope's blocked ipset).
 * `deactivate` = `del` (IPs are removed from the ipset, restoring access).
 *
 * Every call writes to `enforcement_log`. Failures never propagate to the
 * caller — domain state (Restriction record, points, ladder) proceeds
 * regardless of router availability.
 */
@Injectable()
export class RouterEnforcementService implements RestrictionBackend {
  private readonly logger = new Logger('RouterEnforcementService');

  constructor(
    @Inject(ROUTER_ENFORCEMENT_CONFIG)
    private readonly config: RouterEnforcementConfig,
    @Inject(ROUTER_HTTP_CLIENT)
    private readonly http: RouterHttpClient,
    @InjectRepository(DeviceEntity)
    private readonly devices: Repository<DeviceEntity>,
    @InjectRepository(EnforcementLogEntity)
    private readonly enforcementLog: Repository<EnforcementLogEntity>,
  ) {}

  /**
   * Engage the block: a single batched `add` call for every IP enrolled to
   * the Trackee. Trackees with no IP-bearing Devices produce a `skipped`
   * log row (so the admin UI can surface "not enforced").
   */
  async activate(
    userId: string,
    scope: RestrictionScope,
    restrictionId: string,
  ): Promise<void> {
    await this.apply('add', scope, userId, { userId, restrictionId });
  }

  /** Release the block: a single batched `del` call. */
  async deactivate(
    userId: string,
    scope: RestrictionScope,
    restrictionId: string | null,
  ): Promise<void> {
    await this.apply('del', scope, userId, { userId, restrictionId });
  }

  /**
   * Returns the EdgeRouter-reported "all IPs present in the blocked ipset"
   * flag, or null on transport/parse failure. The admin dashboard summary
   * is the sole consumer today.
   */
  async status(scope: RestrictionScope, ip: string): Promise<boolean | null> {
    const trimmed = (ip ?? '').trim();
    if (!trimmed) return null;
    const url = this.urlFor('status', scope, trimmed);
    try {
      const res = await this.http.request('GET', url, this.headers());
      if (!res.ok) return null;
      const parsed = JSON.parse(res.body) as {
        all_present?: boolean;
        devices?: Array<{ ip: string; present?: boolean }>;
      };
      if (typeof parsed.all_present === 'boolean') return parsed.all_present;
      // Fall back to the per-device `present` flag when the response omits
      // `all_present` (only happens on malformed bodies we don't expect).
      const only = parsed.devices?.[0];
      return typeof only?.present === 'boolean' ? only.present : null;
    } catch (err) {
      this.logger.warn(`status failed scope=${scope} ip=${trimmed}: ${err}`);
      return null;
    }
  }

  /** Admin Restrictions screen — enforcement log (most-recent-first). */
  async recentLog(limit = 100): Promise<EnforcementLogEntity[]> {
    return this.enforcementLog.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  private async ipsFor(userId: string): Promise<string[]> {
    const rows = await this.devices.find({ where: { userId } });
    return rows
      .map((d) => (d.ipAddress ?? '').trim())
      .filter((ip) => ip.length > 0);
  }

  private async apply(
    action: EnforcementAction,
    scope: RestrictionScope,
    userId: string,
    ctx: AdapterCallContext,
  ): Promise<void> {
    const ips = await this.ipsFor(userId);
    if (ips.length === 0) {
      await this.logRow({
        ctx,
        scope,
        action,
        target: null,
        result: 'skipped',
        httpStatus: null,
        error: 'no IP-bearing devices enrolled',
      });
      return;
    }

    const csv = ips.join(',');
    const url = this.urlFor(action, scope, csv);
    try {
      const res = await this.http.request('POST', url, this.headers());
      if (res.ok) {
        await this.logRow({
          ctx,
          scope,
          action,
          target: csv,
          result: 'ok',
          httpStatus: res.status,
          error: null,
        });
        return;
      }
      this.logger.warn(
        `${action} ${scope} ips=${csv} returned http=${res.status}`,
      );
      await this.logRow({
        ctx,
        scope,
        action,
        target: csv,
        result: 'error',
        httpStatus: res.status,
        error: res.body?.slice(0, 500) || null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`${action} ${scope} ips=${csv} threw: ${message}`);
      await this.logRow({
        ctx,
        scope,
        action,
        target: csv,
        result: 'error',
        httpStatus: null,
        error: message.slice(0, 500),
      });
    }
  }

  private urlFor(
    action: EnforcementAction | 'status',
    scope: RestrictionScope,
    ipParam: string,
  ): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    return `${base}/${scope}/${action}?ip=${encodeURIComponent(ipParam)}`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.bearerToken}`,
      Accept: 'application/json',
    };
  }

  private async logRow(input: {
    ctx: AdapterCallContext;
    scope: RestrictionScope;
    action: EnforcementAction;
    target: string | null;
    result: EnforcementResult;
    httpStatus: number | null;
    error: string | null;
  }): Promise<void> {
    try {
      await this.enforcementLog.save(
        this.enforcementLog.create({
          restrictionId: input.ctx.restrictionId,
          userId: input.ctx.userId,
          backend: 'router',
          scope: input.scope,
          action: input.action,
          targetAddress: input.target,
          result: input.result,
          httpStatus: input.httpStatus,
          error: input.error,
        }),
      );
    } catch (err) {
      this.logger.error(
        `enforcement_log write failed user=${input.ctx.userId} scope=${input.scope}: ${err}`,
      );
    }
  }
}
