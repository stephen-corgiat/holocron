import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UserEntity } from '../users/user.entity';
import { CategoryEntity } from './category.entity';
import { GoalEntity } from './goal.entity';
import { GoalCompletionEntity } from './goal-completion.entity';
import { GoalFavoriteEntity } from './goal-favorite.entity';
import { GoalInProgressEntity } from './goal-in-progress.entity';
import { CategoriesService } from './categories.service';
import { GoalsService } from './goals.service';
import { CategoriesController } from './categories.controller';
import { GoalsController } from './goals.controller';
import { TransactionsModule } from '../transactions/transactions.module';
import { HouseholdSettingsModule } from '../household-settings/household-settings.module';
import { RestrictionsModule } from '../restrictions/restrictions.module';
import { RestrictionEntity } from '../restrictions/restriction.entity';
import { RealtimeBusModule } from '../realtime/realtime-bus.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CategoryEntity,
      GoalEntity,
      GoalCompletionEntity,
      GoalFavoriteEntity,
      GoalInProgressEntity,
      UserEntity,
      RestrictionEntity,
    ]),
    AuthModule,
    TransactionsModule,
    HouseholdSettingsModule,
    RestrictionsModule,
    RealtimeBusModule,
  ],
  controllers: [CategoriesController, GoalsController],
  providers: [CategoriesService, GoalsService],
  exports: [CategoriesService, GoalsService],
})
export class GoalsModule {}
