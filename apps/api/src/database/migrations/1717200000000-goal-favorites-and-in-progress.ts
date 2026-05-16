import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-Trackee favorites + in-progress lists. Both are pure UX surfaces
 * keyed by (user_id, goal_id). In-progress is soft-capped at 3 in service
 * code via auto-evict of the oldest; the DB enforces only uniqueness.
 */
export class GoalFavoritesAndInProgress1717200000000
  implements MigrationInterface
{
  name = 'GoalFavoritesAndInProgress1717200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS goal_favorites (
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        goal_id     UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, goal_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS goal_favorites_user_idx ON goal_favorites (user_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS goal_in_progress (
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        goal_id     UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, goal_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS goal_in_progress_user_started_idx ON goal_in_progress (user_id, started_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS goal_in_progress`);
    await queryRunner.query(`DROP TABLE IF EXISTS goal_favorites`);
  }
}
