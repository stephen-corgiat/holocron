import { MigrationInterface, QueryRunner } from 'typeorm';

export class TasksAndOccurrences1715300000000 implements MigrationInterface {
  name = 'TasksAndOccurrences1715300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `kind` is a discriminator with room to grow (recurring | windowed |
    // reminder). This migration ships the reminder kind only and
    // enforces the constraint at the column. Later migrations widen it.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        kind        TEXT NOT NULL CHECK (kind IN ('reminder')),
        name        TEXT NOT NULL,
        icon        TEXT,
        due_time    TIME NOT NULL,
        active      BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS task_assignments (
        task_id  UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, user_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_task_assignments_user ON task_assignments (user_id)`,
    );

    // status reserves the wider vocabulary (active | excused | deferred |
    // complete | missed | pending_review). Reminders only ever produce
    // 'active' rows here — auto-complete is computed at read time
    // from scheduled_at vs. now, per the rule that past reminders always
    // render as ✓ regardless of state.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS occurrences (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id       UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        scheduled_at  TIMESTAMPTZ NOT NULL,
        status        TEXT NOT NULL DEFAULT 'active',
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_occ_task_user_day
         ON occurrences (task_id, user_id, ((scheduled_at AT TIME ZONE 'UTC')::date))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_occ_user_scheduled ON occurrences (user_id, scheduled_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_occ_user_scheduled`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_occ_task_user_day`);
    await queryRunner.query(`DROP TABLE IF EXISTS occurrences`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_task_assignments_user`);
    await queryRunner.query(`DROP TABLE IF EXISTS task_assignments`);
    await queryRunner.query(`DROP TABLE IF EXISTS tasks`);
  }
}
