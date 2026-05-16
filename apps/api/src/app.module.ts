import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { isHomeConfigured } from './ha/ha-config';
import { ClockModule } from './clock/clock.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { RealtimeModule } from './realtime/realtime.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { TasksModule } from './tasks/tasks.module';
import { TransactionsModule } from './transactions/transactions.module';
import { HouseholdSettingsModule } from './household-settings/household-settings.module';
import { PendingReviewModule } from './pending-review/pending-review.module';
import { GoalsModule } from './goals/goals.module';
import { PresenceModule } from './presence/presence.module';
import { RestrictionsModule } from './restrictions/restrictions.module';
import { AudibleWarningModule } from './audible-warning/audible-warning.module';

const baseImports = [
  // `npm run dev` runs the API with cwd=apps/api, but the documented .env
  // lives at the repo root — check both (first match wins per key), mirroring
  // database/data-source.ts.
  ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
  ClockModule,
  DatabaseModule,
  UsersModule,
  AuthModule,
  TransactionsModule,
  TasksModule,
  HouseholdSettingsModule,
  PendingReviewModule,
  GoalsModule,
  PresenceModule,
  RestrictionsModule,
  AudibleWarningModule,
  HealthModule,
  RealtimeModule,
];

@Module({
  imports: baseImports,
})
export class AppModule {
  static async register(): Promise<DynamicModule> {
    const imports = [...baseImports];
    // Optional, env-gated home-surface module: present when
    // **either** HA controls **or** Scrypted cameras are configured. Both
    // absent ⇒ no /ha routes, no HA WS, and the FE hides the whole home
    // surface (the both-off bottom-bar cascade).
    if (isHomeConfigured()) {
      const { HaModule } = await import('./ha/ha.module');
      imports.push(HaModule);
    }
    if (process.env.E2E_TEST_MODE === 'true') {
      const { E2eModule } = await import('./e2e/e2e.module');
      imports.push(E2eModule);
    }
    return { module: AppModule, imports };
  }
}
