import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Optional short note shown under the goal name in the tablet catalog
 * Nullable text — historical rows keep `null`.
 */
export class GoalNote1717000000000 implements MigrationInterface {
  name = 'GoalNote1717000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE goals ADD COLUMN IF NOT EXISTS note TEXT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE goals DROP COLUMN IF EXISTS note`);
  }
}
