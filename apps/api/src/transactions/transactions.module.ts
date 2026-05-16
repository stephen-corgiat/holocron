import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UserEntity } from '../users/user.entity';
import { TransactionEntity } from './transaction.entity';
import { CashOutRequestEntity } from './cash-out-request.entity';
import { TransactionsService } from './transactions.service';
import { CashOutService } from './cash-out.service';
import {
  AdminTransactionsController,
  TransactionsController,
} from './transactions.controller';
import { HouseholdSettingsModule } from '../household-settings/household-settings.module';
import { RealtimeBusModule } from '../realtime/realtime-bus.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TransactionEntity,
      CashOutRequestEntity,
      UserEntity,
    ]),
    forwardRef(() => AuthModule),
    HouseholdSettingsModule,
    RealtimeBusModule,
  ],
  controllers: [TransactionsController, AdminTransactionsController],
  providers: [TransactionsService, CashOutService],
  exports: [TransactionsService, CashOutService],
})
export class TransactionsModule {}
