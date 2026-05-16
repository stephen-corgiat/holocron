import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeBusModule } from './realtime-bus.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [AuthModule, RealtimeBusModule],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
