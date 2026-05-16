import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { RealtimeBusModule } from '../realtime/realtime-bus.module';
import { HA_CONFIG, loadHaConfig } from './ha-config';
import { HaController } from './ha.controller';
import { HaProxyService } from './ha-proxy.service';
import { HaEventsService } from './ha-events.service';
import { WeatherPollService } from './weather-poll.service';
import { HaStateStore } from './ha-state-store';
import {
  FetchHaHttpClient,
  HA_HTTP_CLIENT,
} from './ha-http-client';
import { HA_EVENT_SOURCE, WsHaEventSource } from './ha-event-source';
import { FakeHaHttpClient } from '../e2e/fake-ha-http-client';
import { FakeHaEventSource } from '../e2e/fake-ha-event-source';

const IS_E2E = process.env.E2E_TEST_MODE === 'true';

/**
 * The unified "home" surface module: owns the HA control proxy, the
 * live `state_changed` push, and the static Scrypted camera config. Imported
 * when **either** HA controls **or** cameras are configured —
 * `AppModule.register()` gates on `isHomeConfigured()` — so an install with
 * neither has no HA routes, no WS client, and no home UI. On a
 * cameras-only install the WS push is skipped (HaEventsService) and the
 * snapshot serves the static camera block alone.
 *
 * The transports swap to in-memory fakes under `E2E_TEST_MODE` (mirrors
 * RestrictionsModule's router/PiHole fakes) so e2e drives HA state
 * deterministically and never touches the real instance.
 */
@Module({
  imports: [AuthModule, RealtimeBusModule],
  controllers: [HaController],
  providers: [
    {
      provide: HA_CONFIG,
      inject: [ConfigService],
      useFactory: loadHaConfig,
    },
    HaStateStore,
    HaProxyService,
    HaEventsService,
    WeatherPollService,
    FetchHaHttpClient,
    FakeHaHttpClient,
    {
      provide: HA_HTTP_CLIENT,
      useExisting: IS_E2E ? FakeHaHttpClient : FetchHaHttpClient,
    },
    WsHaEventSource,
    FakeHaEventSource,
    {
      provide: HA_EVENT_SOURCE,
      useExisting: IS_E2E ? FakeHaEventSource : WsHaEventSource,
    },
  ],
  // Exported so E2eModule can drive the fakes + reset the store + force a
  // forecast poll (the slow timer is disabled under E2E_TEST_MODE).
  exports: [
    HaStateStore,
    WeatherPollService,
    FakeHaHttpClient,
    FakeHaEventSource,
  ],
})
export class HaModule {}
