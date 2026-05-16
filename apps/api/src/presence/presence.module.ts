import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PresenceScheduleEntity } from './presence.entity';
import { UserEntity } from '../users/user.entity';
import { OccurrenceEntity } from '../tasks/occurrence.entity';
import { LadderPositionEntity } from '../tasks/ladder-position.entity';
import { DailyStreakEntity } from '../tasks/daily-streak.entity';
import { TransactionEntity } from '../transactions/transaction.entity';
import { PresenceService } from './presence.service';
import { PresenceController } from './presence.controller';
import { TabletPresenceController } from './tablet-presence.controller';
import { PresenceReconciliationService } from './presence-reconciliation.service';
import { AuthModule } from '../auth/auth.module';
import { TasksModule } from '../tasks/tasks.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { RealtimeBusModule } from '../realtime/realtime-bus.module';
import { HouseholdSettingsModule } from '../household-settings/household-settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PresenceScheduleEntity,
      UserEntity,
      OccurrenceEntity,
      LadderPositionEntity,
      DailyStreakEntity,
      TransactionEntity,
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => TasksModule),
    TransactionsModule,
    RealtimeBusModule,
    HouseholdSettingsModule,
  ],
  controllers: [PresenceController, TabletPresenceController],
  providers: [PresenceService, PresenceReconciliationService],
  exports: [PresenceService],
})
export class PresenceModule {}
