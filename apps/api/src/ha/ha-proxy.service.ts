import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { HA_CONFIG, HaConfig, FanStateName } from './ha-config';
import { HA_HTTP_CLIENT, HaHttpClient } from './ha-http-client';
import { HaStateStore } from './ha-state-store';
import { HaSnapshot } from './ha-snapshot';
import { shapeOnList } from './on-list-filter';
import { clampSetpoint, climateBounds, shapePanels } from './panel-shaping';
import { shapeWeather } from './weather-forecast';

/**
 * Owns the HA reads/commands the tablet is allowed to make. Every request is
 * validated against the whitelist; the bearer
 * token stays inside the HTTP client.
 */
@Injectable()
export class HaProxyService {
  private readonly logger = new Logger('HaProxyService');

  constructor(
    @Inject(HA_HTTP_CLIENT) private readonly http: HaHttpClient,
    @Inject(HA_CONFIG) private readonly config: HaConfig,
    private readonly store: HaStateStore,
  ) {}

  /** Static camera block: the configured cameras + the one canonical
   * width, present only when at least one camera is configured. Absent ⇒ the
   * FE renders no camera UI. Never folded into a live delta. */
  private cameraFields(): Pick<HaSnapshot, 'cameras' | 'snapshotWidth'> {
    if (this.config.cameras.length === 0) return {};
    return {
      cameras: this.config.cameras.map((c) => ({
        id: c.id,
        name: c.name,
        ...(c.doorbell ? { doorbell: true } : {}),
        urlTemplate: c.urlTemplate,
      })),
      snapshotWidth: this.config.snapshotWidth,
    };
  }

  /** True when the HA control creds are present — i.e. there is a live HA
   * instance to read/command. When false (cameras-only install) the snapshot
   * carries only the static camera block and never reaches for HA. */
  private get haEnabled(): boolean {
    return Boolean(this.config.baseUrl && this.config.token);
  }

  /**
   * Full snapshot for the initial `GET /ha/snapshot`. Reads HA state from the
   * live store when the WS has seeded it; otherwise does a one-shot REST fetch
   * so a cold tablet load still works before the WS settles. Always appends
   * the static camera block — even on a cameras-only install with no HA.
   */
  async snapshot(): Promise<HaSnapshot> {
    const cameras = this.cameraFields();

    // Cameras-only install: no HA creds ⇒ never touch HA. The home surface is
    // entirely the camera tiles; status is irrelevant (no control panels).
    if (!this.haEnabled) {
      return { status: 'disconnected', haEnabled: false, lights: [], ...cameras };
    }

    if (!this.store.isEmpty()) {
      return { ...this.shapeSnapshot(), ...cameras };
    }
    try {
      const states = await this.http.getStates();
      this.store.replaceAll(states);
      return { ...this.shapeSnapshot(), ...cameras };
    } catch (err) {
      this.logger.warn(
        `snapshot fetch failed: ${err instanceof Error ? err.message : err}`,
      );
      return { status: 'disconnected', haEnabled: true, lights: [], ...cameras };
    }
  }

  /**
   * Shape the full snapshot from the live store: the baseline on-list plus
   * every configured optional panel (D15 — absent entities get no field). The
   * weather block joins the live current-temp with the cached forecast.
   */
  private shapeSnapshot(): HaSnapshot {
    const byId = (id: string) => this.store.get(id);
    const weather = shapeWeather(
      this.config.weatherEntity,
      this.config.weatherEntity ? byId(this.config.weatherEntity) : undefined,
      this.store.getForecast(),
    );
    return {
      status: this.store.getStatus(),
      haEnabled: true,
      lights: shapeOnList(this.store.all(), this.config.onList),
      ...shapePanels(this.config, byId),
      ...(weather ? { weather } : {}),
    };
  }

  /**
   * Toggle a light/switch. Validates the entity's domain is in the
   * controllable whitelist (rejects everything else with 403) and maps to the
   * matching `turn_on`/`turn_off` service.
   */
  async toggle(entityId: string, on: boolean): Promise<void> {
    const domain = entityId.slice(0, entityId.indexOf('.'));
    if (!this.config.onList.includeDomains.includes(domain)) {
      throw new ForbiddenException(
        `entity ${entityId} is not in the controllable whitelist`,
      );
    }
    await this.http.callService(domain, on ? 'turn_on' : 'turn_off', {
      entity_id: entityId,
    });
  }

  /**
   * Thermostat ±: server-side read-modify-write. The tablet sends only the
   * entity + a direction; we read the current target off the live store, step
   * by the entity's `target_temp_step`, **clamp to [min,max]**, and write back.
   * Rejects any entity that isn't the configured climate entity (403).
   */
  async nudgeClimate(entityId: string, dir: 1 | -1): Promise<void> {
    if (!this.config.climateEntity || entityId !== this.config.climateEntity) {
      throw new ForbiddenException(
        `entity ${entityId} is not the configured climate entity`,
      );
    }
    const state = this.store.get(entityId);
    if (!state) {
      throw new ForbiddenException(`climate ${entityId} has no known state`);
    }
    const { min, max, step } = climateBounds(state);
    const currentTarget = Number(state.attributes?.['temperature']);
    const base = Number.isNaN(currentTarget) ? min : currentTarget;
    const next = clampSetpoint(base + dir * step, min, max, step);
    await this.http.callService('climate', 'set_temperature', {
      entity_id: entityId,
      temperature: next,
    });
  }

  /**
   * House fan Off/Low/High via the config-driven state→service map (no
   * hard-coded service). Rejects any entity but the configured fan (403).
   */
  async setFan(entityId: string, state: FanStateName): Promise<void> {
    if (!this.config.fanEntity || entityId !== this.config.fanEntity) {
      throw new ForbiddenException(
        `entity ${entityId} is not the configured fan entity`,
      );
    }
    const spec = this.config.fanServices[state];
    const dot = spec.service.indexOf('.');
    const domain = spec.service.slice(0, dot);
    const service = spec.service.slice(dot + 1);
    await this.http.callService(domain, service, {
      entity_id: entityId,
      ...(spec.data ?? {}),
    });
  }

  /**
   * Momentary scene action (`button.press`) — fire-and-forget, no state
   * (Clean Kitchen). Rejects any id not in the configured button list.
   */
  async pressButton(entityId: string): Promise<void> {
    if (!this.config.scenes.buttons.includes(entityId)) {
      throw new ForbiddenException(
        `entity ${entityId} is not a configured scene button`,
      );
    }
    await this.http.callService('button', 'press', { entity_id: entityId });
  }

  /**
   * Stateful scene toggle (`input_boolean.turn_on`/`turn_off`) — Night Mode.
   * Rejects any id not in the configured boolean list.
   */
  async setBoolean(entityId: string, on: boolean): Promise<void> {
    if (!this.config.scenes.booleans.includes(entityId)) {
      throw new ForbiddenException(
        `entity ${entityId} is not a configured scene toggle`,
      );
    }
    await this.http.callService(
      'input_boolean',
      on ? 'turn_on' : 'turn_off',
      { entity_id: entityId },
    );
  }
}
