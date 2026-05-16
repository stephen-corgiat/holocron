import { MigrationInterface, QueryRunner } from 'typeorm';

export class TieredGoals1716000000000 implements MigrationInterface {
  name = 'TieredGoals1716000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE goals ADD COLUMN IF NOT EXISTS tier_values JSONB NOT NULL DEFAULT '[]'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE goals DROP COLUMN IF EXISTS tier_values`);
  }
}
