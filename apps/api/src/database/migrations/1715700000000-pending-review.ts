import { MigrationInterface, QueryRunner } from 'typeorm';

export class PendingReview1715700000000 implements MigrationInterface {
  name = 'PendingReview1715700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS requires_verification BOOLEAN NOT NULL DEFAULT FALSE`,
    );

    await queryRunner.query(
      `ALTER TABLE occurrences ADD COLUMN IF NOT EXISTS pending_since TIMESTAMPTZ`,
    );

    // txn_group_id ties the claw_back + penalty pair posted at rejection time
    // into a single ledger transaction grouping (GLOSSARY.md: the rejection
    // event reverses both the optimistic credit and any deferred consequences
    // — they live as one group for audit + UI grouping).
    await queryRunner.query(
      `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS txn_group_id UUID`,
    );

    await queryRunner.query(
      `ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_kind_check`,
    );
    await queryRunner.query(
      `ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check CHECK (kind IN ('earn', 'penalty', 'claw_back'))`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS household_settings (
        id                       INT PRIMARY KEY DEFAULT 1,
        pending_review_timeout   INTERVAL NOT NULL DEFAULT INTERVAL '48 hours',
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT household_settings_singleton CHECK (id = 1)
      )
    `);
    await queryRunner.query(
      `INSERT INTO household_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS household_settings`);
    await queryRunner.query(
      `ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_kind_check`,
    );
    await queryRunner.query(
      `ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check CHECK (kind IN ('earn', 'penalty'))`,
    );
    await queryRunner.query(
      `ALTER TABLE transactions DROP COLUMN IF EXISTS txn_group_id`,
    );
    await queryRunner.query(
      `ALTER TABLE occurrences DROP COLUMN IF EXISTS pending_since`,
    );
    await queryRunner.query(
      `ALTER TABLE tasks DROP COLUMN IF EXISTS requires_verification`,
    );
  }
}
