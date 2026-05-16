import {
  Inject,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CLOCK, Clock } from '../clock/clock';
import { OccurrenceEntity } from '../tasks/occurrence.entity';
import { UserEntity } from '../users/user.entity';
import { HouseholdSettingsModule } from '../household-settings/household-settings.module';
import { PresenceModule } from '../presence/presence.module';
import { AudibleWarningService } from './audible-warning.service';
import { RealtimeBusModule } from '../realtime/realtime-bus.module';

const ONE_MINUTE_MS = 60_000;

@Module({
  imports: [
    TypeOrmModule.forFeature([OccurrenceEntity, UserEntity]),
    HouseholdSettingsModule,
    PresenceModule,
    RealtimeBusModule,
  ],
  providers: [AudibleWarningService],
  exports: [AudibleWarningService],
})
export class AudibleWarningModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('AudibleWarningModule');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly service: AudibleWarningService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    if (process.env.E2E_TEST_MODE === 'true') return;
    this.timer = setInterval(() => {
      void this.service.tick(this.clock.now()).catch((err) => {
        this.logger.warn(
          `audible-warning tick failed: ${
            err instanceof Error ? err.message : err
          }`,
        );
      });
    }, ONE_MINUTE_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
