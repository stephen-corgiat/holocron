import { Global, Module } from '@nestjs/common';
import { CLOCK } from './clock';
import { SystemClock } from './system-clock';
import { FakeClock } from './fake-clock';

const isE2eMode = process.env.E2E_TEST_MODE === 'true';

@Global()
@Module({
  providers: [
    SystemClock,
    FakeClock,
    {
      provide: CLOCK,
      useExisting: isE2eMode ? FakeClock : SystemClock,
    },
  ],
  exports: [CLOCK, FakeClock, SystemClock],
})
export class ClockModule {}
