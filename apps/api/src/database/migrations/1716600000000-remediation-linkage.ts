import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remediation paths.
 *
 * Adds `remediation_for_restriction_id` to `goal_completions` so a successful
 * goal completion that also lifts a Restriction can be traced back to it.
 */
export class RemediationLinkage1716600000000 implements MigrationInterface {
  name = 'RemediationLinkage1716600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE goal_completions
       ADD COLUMN IF NOT EXISTS remediation_for_restriction_id UUID
       REFERENCES restrictions(id) ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS goal_completions_remediation_idx
       ON goal_completions (remediation_for_restriction_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS goal_completions_remediation_idx`,
    );
    await queryRunner.query(
      `ALTER TABLE goal_completions DROP COLUMN IF EXISTS remediation_for_restriction_id`,
    );
  }
}
