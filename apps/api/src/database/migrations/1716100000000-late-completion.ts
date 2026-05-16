import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Late completion (ADR-0001).
 *
 * Adds the per-task knobs that gate the late-complete affordance:
 *   - allow_late_completion (default true)
 *   - late_window_minutes (default 720 = 12h)
 */
export class LateCompletion1716100000000 implements MigrationInterface {
  name = 'LateCompletion1716100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS allow_late_completion BOOLEAN NOT NULL DEFAULT TRUE`,
    );
    await queryRunner.query(
      `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS late_window_minutes INT NOT NULL DEFAULT 720`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tasks DROP COLUMN IF EXISTS late_window_minutes`,
    );
    await queryRunner.query(
      `ALTER TABLE tasks DROP COLUMN IF EXISTS allow_late_completion`,
    );
  }
}
