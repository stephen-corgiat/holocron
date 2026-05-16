import { MigrationInterface, QueryRunner } from 'typeorm';

export class Users1715100000000 implements MigrationInterface {
  name = 'Users1715100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username        TEXT NOT NULL,
        display_name    TEXT NOT NULL,
        password_hash   TEXT NOT NULL,
        is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
        is_restrictable BOOLEAN NOT NULL DEFAULT FALSE,
        router_id       TEXT,
        avatar          TEXT,
        color           TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (username)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_users_username`);
    await queryRunner.query(`DROP TABLE IF EXISTS users`);
  }
}
