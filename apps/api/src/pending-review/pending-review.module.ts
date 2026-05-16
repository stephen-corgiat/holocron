import {
  Inject,
  Module,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CLOCK, Clock } from '../clock/clock';
import { AuthModule } from '../auth/auth.module';
import { OccurrenceEntity } from '../tasks/occurrence.entity';
import { TransactionEntity } from '../transactions/transaction.entity';
import { UserEntity } from '../users/user.entity';
import { TasksModule } from '../tasks/tasks.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { HouseholdSettingsModule } from '../household-settings/household-settings.module';
import { PendingReviewService } from './pending-review.service';
import { PendingReviewController } from './pending-review.controller';

const ONE_MINUTE_MS = 60_000;

@Module({
  imports: [
    TypeOrmModule.forFeature([OccurrenceEntity, TransactionEntity, UserEntity]),
    AuthModule,
    TasksModule,
    TransactionsModule,
    HouseholdSettingsModule,
  ],
  controllers: [PendingReviewController],
  providers: [PendingReviewService],
  exports: [PendingReviewService],
})
export class PendingReviewModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PendingReviewModule');
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly pending: PendingReviewService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    if (process.env.E2E_TEST_MODE === 'true') return;
    this.sweepTimer = setInterval(() => {
      void this.pending.sweep(this.clock.now()).catch((err) => {
        this.logger.warn(
          `pending-review sweep failed: ${err instanceof Error ? err.message : err}`,
        );
      });
    }, ONE_MINUTE_MS);
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }
}
