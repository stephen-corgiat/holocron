import { Module } from '@nestjs/common';
import { RealtimeBus } from './realtime-bus';

/**
 * Leaf module exporting the in-process `RealtimeBus`. Feature modules
 * import this to obtain the bus without dragging in the WebSocket gateway
 * (which depends on AuthModule → UsersModule).
 */
@Module({
  providers: [RealtimeBus],
  exports: [RealtimeBus],
})
export class RealtimeBusModule {}
