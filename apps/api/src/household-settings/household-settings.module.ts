import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { HouseholdSettingsEntity } from './household-settings.entity';
import { HouseholdSettingsService } from './household-settings.service';
import { HouseholdSettingsController } from './household-settings.controller';
import { PublicSettingsController } from './public-settings.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([HouseholdSettingsEntity]),
    forwardRef(() => AuthModule),
  ],
  controllers: [HouseholdSettingsController, PublicSettingsController],
  providers: [HouseholdSettingsService],
  exports: [HouseholdSettingsService],
})
export class HouseholdSettingsModule {}
