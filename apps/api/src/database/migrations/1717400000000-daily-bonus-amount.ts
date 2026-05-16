import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Make the Daily-routine-streak bonus configurable.
 *
 * Adds `daily_bonus_amount` (integer points awarded on a qualifying streak
 * advance) to household_settings, defaulting to 5. `0` disables the bonus.
 */
export class DailyBonusAmount1717400000000 implements MigrationInterface {
  name = 'DailyBonusAmount1717400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE household_settings
       ADD COLUMN IF NOT EXISTS daily_bonus_amount INTEGER NOT NULL DEFAULT 5`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE household_settings
       DROP COLUMN IF EXISTS daily_bonus_amount`,
    );
  }
}
