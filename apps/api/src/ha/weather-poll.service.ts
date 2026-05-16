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
import { HaStateStore } from './ha-state-store';
import { parseForecast, shapeWeather } from './weather-forecast';

/** ~20 min — relaxed because `get_forecasts` returns HA's cached forecast. */
const POLL_INTERVAL_MS = 20 * 60 * 1000;

/**
 * Slow-polls `weather.get_forecasts` and folds today's condition/low/high into
 * the cached forecast. The current temperature rides the
 * normal `state_changed` push; this only supplies the forecast fields, which
 * HA does not push. Each refresh re-emits the whole `weather` block so the
 * tablet stays current with no round-trip.
 *
 * In `E2E_TEST_MODE` the timer is NOT started — the suite drives a refresh via
 * `/_e2e/ha/forecast-poll` so it never races the test (mirrors the task
 * schedulers).
 */
@Injectable()
export class WeatherPollService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('WeatherPollService');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(HA_HTTP_CLIENT) private readonly http: HaHttpClient,
    @Inject(HA_CONFIG) private readonly config: HaConfig,
    private readonly store: HaStateStore,
    private readonly bus: RealtimeBus,
  ) {}

  onModuleInit(): void {
    if (!this.config.weatherEntity) return; // weather panel not configured
    // Prime the cache once at boot so the first snapshot has a forecast.
    void this.poll();
    if (process.env.E2E_TEST_MODE === 'true') return;
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Fetch the cached forecast, store it, and re-emit the shaped weather block. */
  async poll(): Promise<void> {
    const entityId = this.config.weatherEntity;
    if (!entityId) return;
    try {
      const raw = await this.http.callServiceWithResponse(
        'weather',
        'get_forecasts',
        { entity_id: entityId, type: 'daily' },
      );
      const forecast = parseForecast(raw, entityId);
      if (forecast) this.store.setForecast(forecast);
    } catch (err) {
      this.logger.warn(
        `weather forecast poll failed: ${err instanceof Error ? err.message : err}`,
      );
    }
    this.emitWeather();
  }

  private emitWeather(): void {
    const entityId = this.config.weatherEntity;
    if (!entityId) return;
    const weather = shapeWeather(
      entityId,
      this.store.get(entityId),
      this.store.getForecast(),
    );
    if (weather) this.bus.emit({ kind: 'ha:state_changed', delta: { weather } });
  }
}
