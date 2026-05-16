import { MigrationInterface, QueryRunner } from 'typeorm';

export class TrackeeCrud1715200000000 implements MigrationInterface {
  name = 'TrackeeCrud1715200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Trackees that aren't admins don't sign in — they're impersonated by the
    // household-tablet session — so username and password_hash become optional.
    await queryRunner.query(`DROP INDEX IF EXISTS idx_users_username`);
    await queryRunner.query(
      `ALTER TABLE users ALTER COLUMN username DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_users_username ON users (username) WHERE username IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN IF EXISTS deactivated_at`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_users_username`);
    await queryRunner.query(
      `ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE users ALTER COLUMN username SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_users_username ON users (username)`,
    );
  }
}
