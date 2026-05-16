import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Windowed tasks (kind=windowed, miss at window_end).
 *
 * Adds the third task kind. A Windowed task has a deadline as a window
 * (`window_start`, `window_end`) rather than a single moment. The Miss
 * fires at `window_end`; there is no Late completion (the window already
 * provided the flex).
 *
 * Schema:
 *   tasks.window_start_offset_minutes / window_end_offset_minutes — durations
 *     from the cadence anchor for recurring windowed tasks (NULL otherwise).
 *   occurrences.window_end — the deadline timestamp (NULL for non-windowed).
 *     scheduled_at carries window_start for windowed occurrences, which is
 *     also the visibility-gate the tablet uses.
 */
export class WindowedTasks1716300000000 implements MigrationInterface {
  name = 'WindowedTasks1716300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_kind_check`,
    );
    await queryRunner.query(
      `ALTER TABLE tasks ADD CONSTRAINT tasks_kind_check CHECK (kind IN ('reminder', 'recurring', 'windowed'))`,
    );
    await queryRunner.query(
      `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS window_start_offset_minutes INT`,
    );
    await queryRunner.query(
      `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS window_end_offset_minutes INT`,
    );
    await queryRunner.query(
      `ALTER TABLE occurrences ADD COLUMN IF NOT EXISTS window_end TIMESTAMPTZ`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE occurrences DROP COLUMN IF EXISTS window_end`,
    );
    await queryRunner.query(
      `ALTER TABLE tasks DROP COLUMN IF EXISTS window_end_offset_minutes`,
    );
    await queryRunner.query(
      `ALTER TABLE tasks DROP COLUMN IF EXISTS window_start_offset_minutes`,
    );
    await queryRunner.query(
      `ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_kind_check`,
    );
    await queryRunner.query(
      `ALTER TABLE tasks ADD CONSTRAINT tasks_kind_check CHECK (kind IN ('reminder', 'recurring'))`,
    );
  }
}
