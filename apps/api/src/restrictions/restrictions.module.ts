import {
  Inject,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CLOCK, Clock } from '../clock/clock';
import { AuthModule } from '../auth/auth.module';
import { UserEntity } from '../users/user.entity';
import { DeviceEntity } from '../users/device.entity';
import { RestrictionEntity } from './restriction.entity';
import { RestrictionCauseEntity } from './restriction-cause.entity';
import { RemediationRequestEntity } from './remediation-request.entity';
import { EnforcementLogEntity } from './enforcement-log.entity';
import { RestrictionsService } from './restrictions.service';
import { RealtimeBusModule } from '../realtime/realtime-bus.module';
import { RestrictionsController } from './restrictions.controller';
import { LiftService } from './lift';
import {
  RESTRICTION_BACKEND_PIHOLE,
  RESTRICTION_BACKEND_ROUTER,
} from './restriction-backend';
import { RestrictionEnforcementService } from './restriction-enforcement.service';
import { RouterEnforcementService } from './router-enforcement.service';
import { PiHoleEnforcementService } from './pihole-enforcement.service';
import {
  FetchRouterHttpClient,
  ROUTER_ENFORCEMENT_CONFIG,
  ROUTER_HTTP_CLIENT,
  RouterEnforcementConfig,
} from './router-enforcement';
import {
  FetchPiHoleHttpClient,
  PIHOLE_ENFORCEMENT_CONFIG,
  PIHOLE_HTTP_CLIENT,
  PiHoleEnforcementConfig,
} from './pihole-enforcement';
import { FakeRouterHttpClient } from '../e2e/fake-router-http-client';
import { FakePiHoleHttpClient } from '../e2e/fake-pihole-http-client';

const DEFAULT_PIHOLE_GAMES_GROUP = 'blocked-games-dynamic';
const DEFAULT_PIHOLE_STREAMING_GROUP = 'blocked-streaming-dynamic';
const IS_E2E = process.env.E2E_TEST_MODE === 'true';
// Dev-only FAKE_ENFORCEMENT swaps the router/PiHole transports for the
// in-memory e2e fakes without the rest of E2E_TEST_MODE (FakeClock, disabled
// timers), so the API boots on a workstation with no EdgeRouter or PiHole.
// Read via ConfigService (not at import time) so a .env value is honoured.
const useFakeEnforcement = (config: ConfigService): boolean =>
  IS_E2E || config.get<string>('FAKE_ENFORCEMENT') === 'true';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RestrictionEntity,
      RestrictionCauseEntity,
      RemediationRequestEntity,
      EnforcementLogEntity,
      DeviceEntity,
      UserEntity,
    ]),
    forwardRef(() => AuthModule),
    RealtimeBusModule,
  ],
  providers: [
    RestrictionsService,
    LiftService,
    RouterEnforcementService,
    PiHoleEnforcementService,
    {
      provide: RESTRICTION_BACKEND_ROUTER,
      useExisting: RouterEnforcementService,
    },
    {
      provide: RESTRICTION_BACKEND_PIHOLE,
      useExisting: PiHoleEnforcementService,
    },
    RestrictionEnforcementService,
    {
      provide: ROUTER_ENFORCEMENT_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): RouterEnforcementConfig => {
        if (useFakeEnforcement(config)) {
          return { baseUrl: 'http://fake-router.test', bearerToken: 'fake' };
        }
        const baseUrl = config.get<string>('ROUTER_BASE_URL') ?? '';
        const bearerToken = config.get<string>('ROUTER_BEARER_TOKEN') ?? '';
        if (!baseUrl) {
          throw new Error(
            'ROUTER_BASE_URL must be set (EdgeRouter HTTP service base URL).',
          );
        }
        if (!bearerToken) {
          throw new Error(
            'ROUTER_BEARER_TOKEN must be set (static bearer for the EdgeRouter HTTP service).',
          );
        }
        return { baseUrl, bearerToken };
      },
    },
    FakeRouterHttpClient,
    FetchRouterHttpClient,
    {
      provide: ROUTER_HTTP_CLIENT,
      inject: [ConfigService, FakeRouterHttpClient, FetchRouterHttpClient],
      useFactory: (
        config: ConfigService,
        fake: FakeRouterHttpClient,
        real: FetchRouterHttpClient,
      ) => (useFakeEnforcement(config) ? fake : real),
    },
    {
      provide: PIHOLE_ENFORCEMENT_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PiHoleEnforcementConfig => {
        if (useFakeEnforcement(config)) {
          return {
            baseUrl: 'http://fake-pihole.test',
            apiPassword: 'fake',
            groupNamesByScope: {
              games: DEFAULT_PIHOLE_GAMES_GROUP,
              entertainment: DEFAULT_PIHOLE_STREAMING_GROUP,
            },
          };
        }
        const baseUrl = config.get<string>('PIHOLE_BASE_URL') ?? '';
        const apiPassword = config.get<string>('PIHOLE_API_PASSWORD') ?? '';
        if (!baseUrl) {
          throw new Error(
            'PIHOLE_BASE_URL must be set (PiHole REST API base URL).',
          );
        }
        if (!apiPassword) {
          throw new Error(
            'PIHOLE_API_PASSWORD must be set (PiHole REST API password used for /api/auth).',
          );
        }
        return {
          baseUrl,
          apiPassword,
          groupNamesByScope: {
            games:
              config.get<string>('PIHOLE_GAMES_GROUP_NAME') ??
              DEFAULT_PIHOLE_GAMES_GROUP,
            entertainment:
              config.get<string>('PIHOLE_STREAMING_GROUP_NAME') ??
              DEFAULT_PIHOLE_STREAMING_GROUP,
          },
        };
      },
    },
    FakePiHoleHttpClient,
    FetchPiHoleHttpClient,
    {
      provide: PIHOLE_HTTP_CLIENT,
      inject: [ConfigService, FakePiHoleHttpClient, FetchPiHoleHttpClient],
      useFactory: (
        config: ConfigService,
        fake: FakePiHoleHttpClient,
        real: FetchPiHoleHttpClient,
      ) => (useFakeEnforcement(config) ? fake : real),
    },
  ],
  controllers: [RestrictionsController],
  exports: [
    RestrictionsService,
    LiftService,
    RestrictionEnforcementService,
    FakeRouterHttpClient,
    FakePiHoleHttpClient,
  ],
})
export class RestrictionsModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('RestrictionsModule');
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly restrictions: RestrictionsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    if (process.env.E2E_TEST_MODE === 'true') return;
    // Wait-out sweep: lifts any Restriction whose effective_expires_at has
    // passed. Short cadence keeps lift latency low; per-call work is bounded
    // by the row count due at that moment.
    this.sweepTimer = setInterval(() => {
      void this.restrictions.sweepExpired(this.clock.now()).catch((err) => {
        this.logger.warn(
          `restriction wait-out sweep failed: ${
            err instanceof Error ? err.message : err
          }`,
        );
      });
    }, 60_000);
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }
}
