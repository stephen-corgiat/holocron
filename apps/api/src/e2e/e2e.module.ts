import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { TasksModule } from '../tasks/tasks.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { GoalsModule } from '../goals/goals.module';
import { RestrictionsModule } from '../restrictions/restrictions.module';
import { PendingReviewModule } from '../pending-review/pending-review.module';
import { AudibleWarningModule } from '../audible-warning/audible-warning.module';
import { HaModule } from '../ha/ha.module';
import { E2eController } from './e2e.controller';
import { E2eResetService } from './e2e-reset.service';
import { E2eFactoryService } from './e2e-factory.service';

/**
 * Only loaded when `E2E_TEST_MODE=true` (via AppModule.register()). Mounts
 * the `/_e2e/*` controller with endpoints for DB reset, clock control,
 * scheduler triggering, fake-HTTP-client log inspection, and entity
 * factories. The fake router and PiHole HTTP clients themselves live in
 * RestrictionsModule's providers list (also gated on E2E_TEST_MODE) and
 * are exported so this module can re-export them via injection.
 */
@Module({
  imports: [
    UsersModule,
    AuthModule,
    TasksModule,
    TransactionsModule,
    GoalsModule,
    RestrictionsModule,
    PendingReviewModule,
    AudibleWarningModule,
    HaModule,
  ],
  controllers: [E2eController],
  providers: [E2eResetService, E2eFactoryService],
})
export class E2eModule {}
