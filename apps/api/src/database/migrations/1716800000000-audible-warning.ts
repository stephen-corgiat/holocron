import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Audible warning.
 *
 * Adds `audible_warning_at` (HH:MM string, nullable to disable) and
 * `audible_warning_last_fired_on` (date stamp for once-per-day idempotency)
 * to household_settings.
 */
export class AudibleWarning1716800000000 implements MigrationInterface {
  name = 'AudibleWarning1716800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE household_settings
       ADD COLUMN IF NOT EXISTS audible_warning_at TEXT`,
    );
    await queryRunner.query(
      `ALTER TABLE household_settings
       ADD COLUMN IF NOT EXISTS audible_warning_last_fired_on DATE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE household_settings
       DROP COLUMN IF EXISTS audible_warning_last_fired_on`,
    );
    await queryRunner.query(
      `ALTER TABLE household_settings
       DROP COLUMN IF EXISTS audible_warning_at`,
    );
  }
}
