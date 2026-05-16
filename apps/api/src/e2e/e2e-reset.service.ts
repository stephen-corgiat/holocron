import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UsersService } from '../users/users.service';
import { DevicesService } from '../users/devices.service';
import { AuthService } from '../auth/auth.service';
import { CategoriesService } from '../goals/categories.service';

export interface E2eResetResult {
  admin_user_id: string;
  admin_token: string;
  tablet_token: string;
  trackee_user_id: string;
  enrollment_code: string;
  category_id: string;
}

/**
 * Truncate all domain tables and create a minimal floor for each e2e test:
 * one admin user (alice / alice-pw) and one Restrictable Trackee (bob).
 * Returns auth tokens so the Playwright fixture can stuff them into the
 * browser's localStorage without hitting the login flow for every test.
 */
@Injectable()
export class E2eResetService {
  private readonly logger = new Logger('E2eResetService');

  constructor(
    private readonly dataSource: DataSource,
    private readonly users: UsersService,
    private readonly devices: DevicesService,
    private readonly auth: AuthService,
    private readonly categories: CategoriesService,
  ) {}

  async reset(): Promise<E2eResetResult> {
    await this.truncateAll();
    // Seed the singleton household_settings row up-front. Production code
    // lazily ensure-creates this row on first read, but several tablet
    // endpoints kick off parallel reads that race on the insert after a
    // truncate. Pre-seeding sidesteps that race for the test surface.
    //
    // Pin the household time zone to UTC. The e2e suite runs the API with
    // TZ=UTC and computes task `due_time` fields in UTC (see
    // fixtures/wall-clock.ts). The column default is America/Los_Angeles,
    // which would make `due_time` resolve in that zone — silently shifting
    // occurrences across the UTC↔Pacific day boundary when the suite runs in
    // the evening Pacific, and breaking every date-sensitive spec.
    await this.dataSource.query(
      `INSERT INTO household_settings (id, time_zone) VALUES (1, 'UTC')
         ON CONFLICT (id) DO UPDATE SET time_zone = 'UTC'`,
    );

    const admin = await this.users.createUser({
      displayName: 'Alice',
      isAdmin: true,
      isRestrictable: false,
      username: 'alice',
      password: 'alice-pw',
      color: '#00E5FF',
    });

    const trackee = await this.users.createUser({
      displayName: 'Bob',
      isAdmin: false,
      isRestrictable: true,
      color: '#FFB300',
    });

    await this.devices.create(trackee.id, {
      displayName: "Bob's tablet",
      ipAddress: '10.0.0.42',
      macAddress: 'aa:bb:cc:dd:ee:01',
    });

    const category = await this.categories.create({ name: 'Rewards' });

    const { token: adminToken } = await this.auth.loginAdmin(
      'alice',
      'alice-pw',
    );
    const { code } = this.auth.createEnrollmentCode(admin.id);
    const { token: tabletToken } = await this.auth.redeemEnrollmentCode(code);
    // A fresh code so tests that want to exercise the enrollment UI have
    // one ready to type in.
    const { code: freshCode } = this.auth.createEnrollmentCode(admin.id);

    return {
      admin_user_id: admin.id,
      admin_token: adminToken,
      tablet_token: tabletToken,
      trackee_user_id: trackee.id,
      enrollment_code: freshCode,
      category_id: category.id,
    };
  }

  private async truncateAll(): Promise<void> {
    const rows: Array<{ tablename: string }> = await this.dataSource.query(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public'
         AND tablename NOT IN ('migrations', 'typeorm_metadata')`,
    );
    if (rows.length === 0) return;
    const quoted = rows.map((r) => `"${r.tablename}"`).join(', ');
    await this.dataSource.query(
      `TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`,
    );
    this.logger.debug(`truncated ${rows.length} tables`);
  }
}
