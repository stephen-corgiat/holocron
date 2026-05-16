import { MigrationInterface, QueryRunner } from 'typeorm';

export class RecurringTasksAndTransactions1715400000000
  implements MigrationInterface
{
  name = 'RecurringTasksAndTransactions1715400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Widen the kind discriminator to include 'recurring'. Postgres CHECK
    // constraints aren't named here for the original definition, so drop
    // and re-add with a stable name we can target on rollback.
    await queryRunner.query(`ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_kind_check`);
    await queryRunner.query(
      `ALTER TABLE tasks ADD CONSTRAINT tasks_kind_check CHECK (kind IN ('reminder', 'recurring'))`,
    );

    await queryRunner.query(
      `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence JSONB`,
    );
    await queryRunner.query(
      `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS points INT NOT NULL DEFAULT 0`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind           TEXT NOT NULL CHECK (kind IN ('earn')),
        amount         INT NOT NULL,
        reason         TEXT,
        admin_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
        occurrence_id  UUID REFERENCES occurrences(id) ON DELETE SET NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_txn_user_created ON transactions (user_id, created_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_txn_user_created`);
    await queryRunner.query(`DROP TABLE IF EXISTS transactions`);
    await queryRunner.query(`ALTER TABLE tasks DROP COLUMN IF EXISTS points`);
    await queryRunner.query(`ALTER TABLE tasks DROP COLUMN IF EXISTS recurrence`);
    await queryRunner.query(`ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_kind_check`);
    await queryRunner.query(
      `ALTER TABLE tasks ADD CONSTRAINT tasks_kind_check CHECK (kind IN ('reminder'))`,
    );
  }
}
