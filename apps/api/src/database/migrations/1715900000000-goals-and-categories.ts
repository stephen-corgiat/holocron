import { MigrationInterface, QueryRunner } from 'typeorm';

export class GoalsAndCategories1715900000000 implements MigrationInterface {
  name = 'GoalsAndCategories1715900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE household_settings ADD COLUMN IF NOT EXISTS time_zone TEXT NOT NULL DEFAULT 'America/Los_Angeles'`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name        TEXT NOT NULL,
        sort_order  INT NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS goals (
        id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name                     TEXT NOT NULL,
        icon                     TEXT,
        category_id              UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
        kind                     TEXT NOT NULL DEFAULT 'flat',
        points                   INT NOT NULL DEFAULT 0,
        completion_limit         INT NOT NULL DEFAULT 1,
        limit_window             TEXT NOT NULL DEFAULT 'day',
        show_in_catalog          BOOLEAN NOT NULL DEFAULT TRUE,
        usable_as_remediation    BOOLEAN NOT NULL DEFAULT FALSE,
        assigned_to_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
        active                   BOOLEAN NOT NULL DEFAULT TRUE,
        created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT goals_kind_check CHECK (kind IN ('flat', 'tiered')),
        CONSTRAINT goals_limit_window_check CHECK (limit_window IN ('day', 'week', 'month', 'lifetime')),
        CONSTRAINT goals_completion_limit_check CHECK (completion_limit >= 1 AND completion_limit <= 999),
        CONSTRAINT goals_points_check CHECK (points >= 0)
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS goals_category_idx ON goals (category_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS goals_assigned_idx ON goals (assigned_to_user_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS goal_completions (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        goal_id       UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tier_value    INT NOT NULL,
        completed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS goal_completions_goal_user_idx ON goal_completions (goal_id, user_id, completed_at)`,
    );

    await queryRunner.query(
      `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS goal_completion_id UUID REFERENCES goal_completions(id) ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE transactions DROP COLUMN IF EXISTS goal_completion_id`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS goal_completions`);
    await queryRunner.query(`DROP TABLE IF EXISTS goals`);
    await queryRunner.query(`DROP TABLE IF EXISTS categories`);
    await queryRunner.query(
      `ALTER TABLE household_settings DROP COLUMN IF EXISTS time_zone`,
    );
  }
}
