import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Presence resolver baseline.
 *
 * Adds the per-Trackee presence_schedules row. The grid_* and one_off_*
 * columns back the N-week grid editor and vacation bulk-add respectively;
 * this migration only populates the recurring_rule_kind discriminator.
 */
export class PresenceSchedules1716200000000 implements MigrationInterface {
  name = 'PresenceSchedules1716200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS presence_schedules (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id             UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        recurring_rule_kind TEXT NOT NULL DEFAULT 'none' CHECK (
          recurring_rule_kind IN ('none', 'full_time', 'n_week_grid')
        ),
        grid_n_weeks        INT,
        grid_cells          JSONB,
        epoch_date          DATE,
        one_off_windows     JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS presence_schedules`);
  }
}
