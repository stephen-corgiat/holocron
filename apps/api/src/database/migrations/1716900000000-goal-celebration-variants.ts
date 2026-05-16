import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Goal Celebration variant registry.
 *
 * `goals.celebration_variant_id` (nullable text) pins a celebration variant
 * id; when null, the frontend picks at random over the registered variants.
 * Values are validated client-side against the in-process registry — no FK,
 * no enum, so dropping or renaming a variant doesn't require a migration.
 */
export class GoalCelebrationVariants1716900000000
  implements MigrationInterface
{
  name = 'GoalCelebrationVariants1716900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE goals ADD COLUMN IF NOT EXISTS celebration_variant_id TEXT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE goals DROP COLUMN IF EXISTS celebration_variant_id`,
    );
  }
}
