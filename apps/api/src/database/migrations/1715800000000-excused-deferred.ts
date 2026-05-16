import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExcusedDeferred1715800000000 implements MigrationInterface {
  name = 'ExcusedDeferred1715800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE occurrences ADD COLUMN IF NOT EXISTS deferred_from_occurrence_id UUID`,
    );
    await queryRunner.query(
      `ALTER TABLE occurrences DROP CONSTRAINT IF EXISTS occurrences_deferred_from_fk`,
    );
    await queryRunner.query(
      `ALTER TABLE occurrences ADD CONSTRAINT occurrences_deferred_from_fk
        FOREIGN KEY (deferred_from_occurrence_id) REFERENCES occurrences(id) ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE occurrences DROP CONSTRAINT IF EXISTS occurrences_deferred_from_fk`,
    );
    await queryRunner.query(
      `ALTER TABLE occurrences DROP COLUMN IF EXISTS deferred_from_occurrence_id`,
    );
  }
}
