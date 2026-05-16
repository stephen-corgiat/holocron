import { MigrationInterface, QueryRunner } from 'typeorm';

export class MissEngine1715500000000 implements MigrationInterface {
  name = 'MissEngine1715500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ladder JSONB NOT NULL DEFAULT '[{"points": 1, "restriction": null}]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ladder_reset_threshold INT NOT NULL DEFAULT 3`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ladder_positions (
        task_id            UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        position           INT NOT NULL DEFAULT 1,
        clean_streak_count INT NOT NULL DEFAULT 0,
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (task_id, user_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS daily_streaks (
        user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        last_qualifying_day  DATE,
        count                INT NOT NULL DEFAULT 0,
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(
      `ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_kind_check`,
    );
    await queryRunner.query(
      `ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check CHECK (kind IN ('earn', 'penalty'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_kind_check`,
    );
    await queryRunner.query(
      `ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check CHECK (kind IN ('earn'))`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS daily_streaks`);
    await queryRunner.query(`DROP TABLE IF EXISTS ladder_positions`);
    await queryRunner.query(`ALTER TABLE tasks DROP COLUMN IF EXISTS ladder_reset_threshold`);
    await queryRunner.query(`ALTER TABLE tasks DROP COLUMN IF EXISTS ladder`);
  }
}
