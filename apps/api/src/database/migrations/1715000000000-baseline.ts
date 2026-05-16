import { MigrationInterface, QueryRunner } from 'typeorm';

export class Baseline1715000000000 implements MigrationInterface {
  name = 'Baseline1715000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS _holocron_baseline (
        id              SMALLINT PRIMARY KEY DEFAULT 1,
        initialized_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `INSERT INTO _holocron_baseline (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS _holocron_baseline`);
  }
}
