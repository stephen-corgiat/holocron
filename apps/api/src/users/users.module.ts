import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './user.entity';
import { DeviceEntity } from './device.entity';
import { DailyStreakEntity } from '../tasks/daily-streak.entity';
import { UsersService } from './users.service';
import { DevicesService } from './devices.service';
import { BootstrapAdminService } from './bootstrap-admin.service';
import { UsersController } from './users.controller';
import { DevicesController } from './devices.controller';
import { AuthModule } from '../auth/auth.module';
import { PresenceModule } from '../presence/presence.module';
import { RealtimeBusModule } from '../realtime/realtime-bus.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, DeviceEntity, DailyStreakEntity]),
    forwardRef(() => AuthModule),
    forwardRef(() => PresenceModule),
    RealtimeBusModule,
  ],
  controllers: [UsersController, DevicesController],
  providers: [UsersService, DevicesService, BootstrapAdminService],
  exports: [UsersService, DevicesService],
})
export class UsersModule {}
