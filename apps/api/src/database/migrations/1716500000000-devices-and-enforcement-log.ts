import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Router enforcement adapter.
 *
 * `devices` is the per-Trackee device list edited from the admin Trackee
 * edit screen. Router enforcement fans out across every device that has a
 * non-null `ip_address`; rows with only a `mac_address` are tracked for the
 * admin's records but are skipped by the adapter.
 *
 * `enforcement_log` records the outcome of every EdgeRouter HTTP call. Rows
 * are append-only and survive the underlying Restriction (FK is `SET NULL`)
 * so the admin log keeps history after a lift.
 */
export class DevicesAndEnforcementLog1716500000000
  implements MigrationInterface
{
  name = 'DevicesAndEnforcementLog1716500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS devices (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        display_name  TEXT NOT NULL,
        ip_address    TEXT,
        mac_address   TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (ip_address IS NOT NULL OR mac_address IS NOT NULL)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS devices_user_id_idx ON devices (user_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS enforcement_log (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        restriction_id  UUID REFERENCES restrictions(id) ON DELETE SET NULL,
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        scope           TEXT NOT NULL CHECK (
          scope IN ('internet', 'entertainment', 'games')
        ),
        action          TEXT NOT NULL CHECK (action IN ('enable', 'disable')),
        ip_address      TEXT,
        result          TEXT NOT NULL CHECK (result IN ('ok', 'error', 'skipped')),
        http_status     INT,
        error           TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS enforcement_log_user_id_idx
        ON enforcement_log (user_id, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS enforcement_log_restriction_id_idx
        ON enforcement_log (restriction_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS enforcement_log`);
    await queryRunner.query(`DROP TABLE IF EXISTS devices`);
  }
}
