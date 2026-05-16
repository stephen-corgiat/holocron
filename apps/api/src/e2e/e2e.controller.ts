import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { FakeClock } from '../clock/fake-clock';
import { MissService } from '../tasks/miss.service';
import { DailyStreakService } from '../tasks/daily-streak.service';
import { PendingReviewService } from '../pending-review/pending-review.service';
import { RestrictionsService } from '../restrictions/restrictions.service';
import { AudibleWarningService } from '../audible-warning/audible-warning.service';
import { OccurrencesService } from '../tasks/occurrences.service';
import { FakeRouterHttpClient } from './fake-router-http-client';
import { FakePiHoleHttpClient } from './fake-pihole-http-client';
import { FakeHaHttpClient } from './fake-ha-http-client';
import { FakeHaEventSource } from './fake-ha-event-source';
import { HaStateStore } from '../ha/ha-state-store';
import { HaEntityState } from '../ha/ha-http-client';
import { WeatherPollService } from '../ha/weather-poll.service';
import { E2eResetService, E2eResetResult } from './e2e-reset.service';
import {
  E2eFactoryService,
  FactoryAdjustInput,
  FactoryGoalInput,
  FactoryTaskInput,
  FactoryTrackeeInput,
} from './e2e-factory.service';

type TickWhich = 'all' | 'miss' | 'pending' | 'restrictions' | 'audible' | 'streak';

/**
 * Test-only HTTP surface. Mounted by E2eModule only when
 * `E2E_TEST_MODE=true`; never reachable in production. All routes are
 * unguarded — they are the only way Playwright drives the API's time and
 * background work, and the E2E_TEST_MODE gate is the security boundary.
 */
@Controller('_e2e')
export class E2eController {
  private readonly logger = new Logger('E2eController');

  constructor(
    private readonly reset: E2eResetService,
    private readonly factory: E2eFactoryService,
    private readonly clock: FakeClock,
    private readonly miss: MissService,
    private readonly streaks: DailyStreakService,
    private readonly pending: PendingReviewService,
    private readonly restrictions: RestrictionsService,
    private readonly audible: AudibleWarningService,
    private readonly occurrences: OccurrencesService,
    @Inject(FakeRouterHttpClient)
    private readonly fakeRouter: FakeRouterHttpClient,
    @Inject(FakePiHoleHttpClient)
    private readonly fakePiHole: FakePiHoleHttpClient,
    @Inject(FakeHaHttpClient)
    private readonly fakeHa: FakeHaHttpClient,
    @Inject(FakeHaEventSource)
    private readonly fakeHaEvents: FakeHaEventSource,
    private readonly haStore: HaStateStore,
    private readonly weatherPoll: WeatherPollService,
  ) {}

  @Post('reset')
  @HttpCode(200)
  async resetAll(): Promise<E2eResetResult> {
    // Default clock to mid-morning on a stable weekday so deadline math is
    // predictable. Tests can override with /clock/set if they need a
    // specific day-of-week or vacation alignment.
    this.clock.set(new Date('2026-05-04T09:00:00.000Z'));
    this.fakeRouter.reset();
    this.fakePiHole.reset();
    this.fakeHa.reset();
    // The HA store is a live singleton — clear it so state doesn't leak
    // between cases; the fake event source comes back "connected".
    this.haStore.replaceAll([]);
    this.haStore.setStatus('ok');
    return this.reset.reset();
  }

  @Get('clock')
  getClock(): { iso: string } {
    return { iso: this.clock.now().toISOString() };
  }

  @Post('clock/set')
  @HttpCode(200)
  setClock(@Body() body: { iso: string }): { iso: string } {
    this.clock.set(new Date(body.iso));
    return this.getClock();
  }

  @Post('clock/advance')
  @HttpCode(200)
  async advanceClock(
    @Body() body: { ms: number },
  ): Promise<{ iso: string }> {
    this.clock.advance(body.ms);
    // Re-materialize today's occurrences in case the advance crossed a day
    // boundary — keeps tests from needing to know about generateForDate.
    await this.occurrences.generateForDate(this.clock.now());
    return this.getClock();
  }

  @Post('scheduler/tick')
  @HttpCode(200)
  async tick(
    @Body() body: { which?: TickWhich } = {},
  ): Promise<{ fired: Record<string, unknown> }> {
    const which = body.which ?? 'all';
    const now = this.clock.now();
    const fired: Record<string, unknown> = {};
    if (which === 'all' || which === 'miss') {
      fired.miss = await this.miss.fireDeadlineTick(now);
    }
    if (which === 'all' || which === 'pending') {
      fired.pending = await this.pending.sweep(now);
    }
    if (which === 'all' || which === 'restrictions') {
      fired.restrictions = await this.restrictions.sweepExpired(now);
    }
    if (which === 'all' || which === 'audible') {
      fired.audible = await this.audible.tick(now);
    }
    if (which === 'streak') {
      const yesterday = new Date(now.getTime() - 24 * 60 * 60_000);
      await this.streaks.rolloverDay(yesterday);
      fired.streak = { rolledOver: yesterday.toISOString() };
    }
    return { fired };
  }

  @Get('router/log')
  routerLog() {
    return { calls: this.fakeRouter.getCalls() };
  }

  @Post('router/reset')
  @HttpCode(200)
  routerReset() {
    this.fakeRouter.reset();
    return { ok: true };
  }

  @Get('pihole/log')
  piholeLog() {
    return { calls: this.fakePiHole.getCalls() };
  }

  @Post('pihole/reset')
  @HttpCode(200)
  piholeReset() {
    this.fakePiHole.reset();
    return { ok: true };
  }

  @Get('ha/log')
  haLog() {
    return { calls: this.fakeHa.getCalls() };
  }

  /**
   * Drive a whitelisted HA entity's state: updates the fake's REST view AND
   * fires a `state_changed` so the WS→`ha:state_changed` push path runs. A
   * physical flip and a software toggle look identical to the suite — both
   * land here.
   */
  @Post('ha/state')
  @HttpCode(200)
  haSetState(
    @Body()
    body: {
      entity_id: string;
      state: string;
      attributes?: Record<string, unknown>;
    },
  ) {
    const next: HaEntityState = {
      entity_id: body.entity_id,
      state: body.state,
      attributes: body.attributes,
    };
    this.fakeHa.setState(next);
    this.fakeHaEvents.fireChange({ entityId: next.entity_id, newState: next });
    return { ok: true };
  }

  @Post('ha/reset')
  @HttpCode(200)
  haReset() {
    this.fakeHa.reset();
    this.haStore.replaceAll([]);
    this.haStore.setStatus('ok');
    this.haStore.setForecast(null);
    return { ok: true };
  }

  /**
   * Seed the canned cached forecast a later `weather.get_forecasts` reflects.
   * `forecast` is the daily entries (HA shape: `[{ condition, templow,
   * temperature }, ...]`); the first entry is today.
   */
  @Post('ha/forecast')
  @HttpCode(200)
  haSetForecast(
    @Body() body: { entity_id: string; forecast: unknown[] },
  ) {
    this.fakeHa.setForecast(body.entity_id, body.forecast ?? []);
    return { ok: true };
  }

  /**
   * Force a weather slow-poll (the production timer is disabled under
   * E2E_TEST_MODE). Reads the canned forecast and emits the shaped `weather`
   * delta — the suite drives this instead of waiting on the real interval.
   */
  @Post('ha/forecast-poll')
  @HttpCode(200)
  async haForecastPoll() {
    await this.weatherPoll.poll();
    return { ok: true };
  }

  @Post('factory/trackee')
  @HttpCode(201)
  async factoryTrackee(@Body() body: FactoryTrackeeInput) {
    return this.factory.createTrackee(body);
  }

  @Post('factory/task')
  @HttpCode(201)
  async factoryTask(@Body() body: FactoryTaskInput) {
    return this.factory.createTask(body);
  }

  @Post('factory/goal')
  @HttpCode(201)
  async factoryGoal(@Body() body: FactoryGoalInput) {
    return this.factory.createGoal(body);
  }

  @Post('factory/adjust-balance')
  @HttpCode(200)
  async factoryAdjust(@Body() body: FactoryAdjustInput) {
    await this.factory.adjustBalance(body);
    return { ok: true };
  }

  @Post('occurrences/generate')
  @HttpCode(200)
  async generateOccurrences() {
    return this.occurrences.generateForDate(this.clock.now());
  }
}
