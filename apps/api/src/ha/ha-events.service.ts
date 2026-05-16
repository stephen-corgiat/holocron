import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { RealtimeBus } from '../realtime/realtime-bus';
import { HA_CONFIG, HaConfig } from './ha-config';
import { HA_HTTP_CLIENT, HaHttpClient } from './ha-http-client';
import { HA_EVENT_SOURCE, HaEventSource, HaStateChange } from './ha-event-source';
import { HaStateStore } from './ha-state-store';
import { affectsOnList, shapeOnList } from './on-list-filter';
import { affectsPanels, shapePanels } from './panel-shaping';
import { shapeWeather } from './weather-forecast';
import { HaSnapshotDelta } from './ha-snapshot';

/**
 * Bridges HA's live `state_changed` stream onto Holocron's socket.io.
 *
 * Deliberately diverges from the existing bare `{at}` nudge events: the `ha:state_changed` event **carries the shaped
 * HaSnapshot delta itself**, so the tablet updates with no follow-up HTTP —
 * one fewer round-trip for the weak device. A physically-flipped switch
 * propagates identically to a software toggle because both arrive here as the
 * same `state_changed`.
 */
@Injectable()
export class HaEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('HaEventsService');

  constructor(
    @Inject(HA_EVENT_SOURCE) private readonly source: HaEventSource,
    @Inject(HA_HTTP_CLIENT) private readonly http: HaHttpClient,
    @Inject(HA_CONFIG) private readonly config: HaConfig,
    private readonly store: HaStateStore,
    private readonly bus: RealtimeBus,
  ) {}

  onModuleInit(): void {
    // Cameras-only install: the module is wired for the static camera
    // config alone, with no HA control creds — there is no HA instance to
    // subscribe to, so skip the WS entirely. The camera tiles need no live
    // push (they self-refresh their `<img>` client-side).
    if (!this.config.baseUrl || !this.config.token) return;
    this.source.onStatus((status) => {
      this.store.setStatus(status);
      if (status === 'ok') {
        // (Re)seed the authoritative state cache on every healthy connect.
        void this.seed();
      } else {
        this.bus.emit({ kind: 'ha:state_changed', delta: { status } });
      }
    });
    this.source.onChange((change) => this.handleChange(change));
    this.source.start();
  }

  onModuleDestroy(): void {
    this.source.stop();
  }

  private async seed(): Promise<void> {
    try {
      const states = await this.http.getStates();
      this.store.replaceAll(states);
    } catch (err) {
      this.logger.warn(
        `state seed failed: ${err instanceof Error ? err.message : err}`,
      );
    }
    this.emitLights();
    // Seed the optional panels too (climate/fan/co2/scenes/weather) so a cold
    // tablet that reconnects mid-session gets every configured block at once.
    this.emitPanels();
  }

  private handleChange(change: HaStateChange): void {
    // Read the prior state *before* applying — the doorbell edge is computed
    // from the off→on transition, so we need the value the store held first.
    const doorbellRing = this.detectDoorbellEdge(change);

    if (change.newState) this.store.apply(change.newState);
    else this.store.remove(change.entityId);

    if (affectsOnList(change.entityId, this.config.onList)) {
      this.emitLights();
    }
    if (affectsPanels(change.entityId, this.config)) {
      this.emitPanels();
    }
    // Edge event: the press is a one-shot nudge,
    // emitted as its own `doorbell` delta — never folded into the steady
    // Currently-On list and not part of `emitLights()`.
    if (doorbellRing) {
      this.bus.emit({
        kind: 'ha:state_changed',
        delta: { doorbell: { rangAt: new Date().toISOString() } },
      });
    }
  }

  /**
   * True when this change is the doorbell sensor's **rising edge** — it was
   * not `on` (any prior state, including unseen/`unavailable`) and is now `on`.
   * The ~15s pulse and the falling edge are deliberately ignored: only the
   * press matters, and the glance's 3-min lifetime is governed FE-side,
   * decoupled from the pulse. No doorbell configured ⇒
   * always false (feature off).
   */
  private detectDoorbellEdge(change: HaStateChange): boolean {
    const entity = this.config.doorbellEntity;
    if (!entity || change.entityId !== entity) return false;
    if (change.newState?.state !== 'on') return false;
    const prior = this.store.get(entity)?.state;
    return prior !== 'on';
  }

  /** Emit the current on-list (and link status) as a shaped delta. */
  private emitLights(): void {
    this.bus.emit({
      kind: 'ha:state_changed',
      delta: {
        status: this.store.getStatus(),
        lights: shapeOnList(this.store.all(), this.config.onList),
      },
    });
  }

  /**
   * Emit the configured optional panels folded from the live store. Each block
   * is emitted whole so the FE's shallow merge is total. The weather
   * block joins the live current-temp with the cached forecast; its
   * condition/low/high are refreshed separately by `WeatherPollService`.
   */
  private emitPanels(): void {
    const byId = (id: string) => this.store.get(id);
    const delta: HaSnapshotDelta = { ...shapePanels(this.config, byId) };
    const weather = shapeWeather(
      this.config.weatherEntity,
      this.config.weatherEntity ? byId(this.config.weatherEntity) : undefined,
      this.store.getForecast(),
    );
    if (weather) delta.weather = weather;
    if (Object.keys(delta).length === 0) return;
    this.bus.emit({ kind: 'ha:state_changed', delta });
  }
}
