import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
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
  PIHOLE_ENFORCEMENT_CONFIG,
  PIHOLE_HTTP_CLIENT,
  PiHoleEnforcementConfig,
  PiHoleHttpClient,
} from './pihole-enforcement';

interface AdapterCallContext {
  restrictionId: string | null;
  userId: string;
}

interface PiHoleGroup {
  id: number;
  name: string;
}

interface PiHoleClientRecord {
  /** The MAC, IP, or hostname identifying the client. */
  client?: string;
  comment?: string | null;
  groups?: number[];
}

/**
 * DNS-layer enforcement via the PiHole REST API. Blocking a Trackee on a
 * `games` or `entertainment` scope means assigning each of their
 * MAC-addressed Devices to a pre-existing PiHole group whose blocklists
 * sinkhole the relevant domains. Unblocking removes the group.
 *
 * Group memberships are read-modify-write to coexist with any manual
 * PiHole admin edits: we never stomp groups we don't own.
 *
 * Session (`sid`) is cached in memory and transparently re-authed on 401.
 * Group IDs are resolved by name once at module init; missing groups fail
 * startup.
 */
@Injectable()
export class PiHoleEnforcementService
  implements RestrictionBackend, OnModuleInit
{
  private readonly logger = new Logger('PiHoleEnforcementService');
  private sid: string | null = null;
  private authInflight: Promise<string> | null = null;
  private groupIdByScope: Partial<Record<RestrictionScope, number>> = {};

  constructor(
    @Inject(PIHOLE_ENFORCEMENT_CONFIG)
    private readonly config: PiHoleEnforcementConfig,
    @Inject(PIHOLE_HTTP_CLIENT)
    private readonly http: PiHoleHttpClient,
    @InjectRepository(DeviceEntity)
    private readonly devices: Repository<DeviceEntity>,
    @InjectRepository(EnforcementLogEntity)
    private readonly enforcementLog: Repository<EnforcementLogEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.resolveGroupIds();
  }

  async activate(
    userId: string,
    scope: RestrictionScope,
    restrictionId: string,
  ): Promise<void> {
    await this.apply('add', scope, userId, { userId, restrictionId });
  }

  async deactivate(
    userId: string,
    scope: RestrictionScope,
    restrictionId: string | null,
  ): Promise<void> {
    await this.apply('del', scope, userId, { userId, restrictionId });
  }

  /**
   * One read-modify-write per MAC-bearing Device. `add` means "ensure the
   * scope's group is in the client's groups list"; `del` means "ensure it
   * is not". Idempotent: no PUT is issued when the state already matches.
   */
  private async apply(
    action: EnforcementAction,
    scope: RestrictionScope,
    userId: string,
    ctx: AdapterCallContext,
  ): Promise<void> {
    const groupId = this.groupIdByScope[scope];
    if (groupId === undefined) {
      this.logger.error(
        `pihole backend asked to ${action} scope=${scope} which has no group id`,
      );
      await this.logRow({
        ctx,
        scope,
        action,
        target: null,
        result: 'error',
        httpStatus: null,
        error: `no PiHole group configured for scope ${scope}`,
      });
      return;
    }

    const macs = await this.macsFor(userId);
    if (macs.length === 0) {
      await this.logRow({
        ctx,
        scope,
        action,
        target: null,
        result: 'skipped',
        httpStatus: null,
        error: 'no MAC-bearing devices enrolled',
      });
      return;
    }

    for (const mac of macs) {
      await this.applyToMac(action, scope, groupId, mac, ctx);
    }
  }

  private async applyToMac(
    action: EnforcementAction,
    scope: RestrictionScope,
    groupId: number,
    mac: string,
    ctx: AdapterCallContext,
  ): Promise<void> {
    try {
      const current = await this.fetchClient(mac);
      const groups = new Set(current?.groups ?? []);
      const hasGroup = groups.has(groupId);
      const shouldHaveGroup = action === 'add';
      if (hasGroup === shouldHaveGroup) {
        // Already in the desired state — record an `ok` row with httpStatus
        // null so the admin sees the action ran but no PUT was needed.
        await this.logRow({
          ctx,
          scope,
          action,
          target: mac,
          result: 'ok',
          httpStatus: null,
          error: null,
        });
        return;
      }

      if (shouldHaveGroup) groups.add(groupId);
      else groups.delete(groupId);

      const body = JSON.stringify({
        comment: current?.comment ?? null,
        groups: Array.from(groups).sort((a, b) => a - b),
      });
      const res = await this.authedRequest(
        'PUT',
        `${this.baseUrl()}/api/clients/${encodeURIComponent(mac)}`,
        body,
      );
      if (res.ok) {
        await this.logRow({
          ctx,
          scope,
          action,
          target: mac,
          result: 'ok',
          httpStatus: res.status,
          error: null,
        });
        return;
      }
      this.logger.warn(
        `pihole ${action} scope=${scope} mac=${mac} returned http=${res.status}`,
      );
      await this.logRow({
        ctx,
        scope,
        action,
        target: mac,
        result: 'error',
        httpStatus: res.status,
        error: res.body?.slice(0, 500) || null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `pihole ${action} scope=${scope} mac=${mac} threw: ${message}`,
      );
      await this.logRow({
        ctx,
        scope,
        action,
        target: mac,
        result: 'error',
        httpStatus: null,
        error: message.slice(0, 500),
      });
    }
  }

  private async fetchClient(mac: string): Promise<PiHoleClientRecord | null> {
    const url = `${this.baseUrl()}/api/clients/${encodeURIComponent(mac)}`;
    const res = await this.authedRequest('GET', url);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`pihole GET clients/${mac} http=${res.status}`);
    }
    const parsed = JSON.parse(res.body) as
      | { clients?: PiHoleClientRecord[] }
      | PiHoleClientRecord;
    if ('clients' in parsed && Array.isArray(parsed.clients)) {
      return parsed.clients[0] ?? null;
    }
    return parsed as PiHoleClientRecord;
  }

  private async resolveGroupIds(): Promise<void> {
    const url = `${this.baseUrl()}/api/groups`;
    const res = await this.authedRequest('GET', url);
    if (!res.ok) {
      throw new Error(
        `failed to fetch PiHole groups at startup (http=${res.status})`,
      );
    }
    const parsed = JSON.parse(res.body) as { groups?: PiHoleGroup[] };
    const byName = new Map<string, number>();
    for (const g of parsed.groups ?? []) byName.set(g.name, g.id);

    const wanted: Array<[RestrictionScope, string]> = [
      ['games', this.config.groupNamesByScope.games],
      ['entertainment', this.config.groupNamesByScope.entertainment],
    ];
    for (const [scope, name] of wanted) {
      const id = byName.get(name);
      if (id === undefined) {
        throw new Error(
          `PiHole group "${name}" (for scope ${scope}) not found — create it before booting`,
        );
      }
      this.groupIdByScope[scope] = id;
    }
    this.logger.log(
      `resolved PiHole groups: ${Object.entries(this.groupIdByScope)
        .map(([s, id]) => `${s}=${id}`)
        .join(' ')}`,
    );
  }

  private async authedRequest(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    body?: string,
  ): Promise<{ status: number; ok: boolean; body: string }> {
    const sid = await this.ensureSid();
    const res = await this.http.request(method, url, this.headers(sid), body);
    if (res.status !== 401) return res;
    // Session expired — re-auth once and retry. Clear the cached sid first
    // so concurrent callers see the miss too.
    this.sid = null;
    const fresh = await this.ensureSid();
    return this.http.request(method, url, this.headers(fresh), body);
  }

  private async ensureSid(): Promise<string> {
    if (this.sid) return this.sid;
    if (this.authInflight) return this.authInflight;
    this.authInflight = (async () => {
      try {
        const url = `${this.baseUrl()}/api/auth`;
        const res = await this.http.request(
          'POST',
          url,
          { 'Content-Type': 'application/json', Accept: 'application/json' },
          JSON.stringify({ password: this.config.apiPassword }),
        );
        if (!res.ok) {
          throw new Error(`pihole auth failed http=${res.status}`);
        }
        const parsed = JSON.parse(res.body) as {
          session?: { sid?: string; valid?: boolean };
          sid?: string;
        };
        const sid = parsed.session?.sid ?? parsed.sid;
        if (!sid) {
          throw new Error('pihole auth response missing sid');
        }
        this.sid = sid;
        return sid;
      } finally {
        this.authInflight = null;
      }
    })();
    return this.authInflight;
  }

  private headers(sid: string): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      sid,
    };
  }

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/+$/, '');
  }

  private async macsFor(userId: string): Promise<string[]> {
    const rows = await this.devices.find({ where: { userId } });
    return rows
      .map((d) => (d.macAddress ?? '').trim())
      .filter((mac) => mac.length > 0);
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
          backend: 'pihole',
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
