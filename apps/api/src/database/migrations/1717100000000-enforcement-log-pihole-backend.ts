import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PiHole enforcement adapter + router API refresh.
 *
 * The `enforcement_log` table now records actions across two backends:
 *
 *   - router (EdgeRouter ipset, scope=internet) — `target_address` is a
 *     comma-separated IP list reflecting the new batched API.
 *   - pihole (DNS group assignment, scope=games | entertainment) —
 *     `target_address` is a single MAC.
 *
 * The action vocabulary follows the router's new ipset verbs (`add` =
 * block, `del` = unblock); the PiHole adapter reuses the same verbs so
 * `add` always means "engage the block". Old `enable`/`disable` rows are
 * rewritten in place — those were per-IP fan-out rows and are still useful
 * history, just under the new vocabulary (`enable`→`del`, `disable`→`add`,
 * matching the semantic flip when /enable meant "allow access" and
 * /disable meant "block access").
 */
export class EnforcementLogPiHoleBackend1717100000000
  implements MigrationInterface
{
  name = 'EnforcementLogPiHoleBackend1717100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add the backend column with a default so existing rows are valid;
    // then drop the default so future inserts must declare it explicitly.
    await queryRunner.query(
      `ALTER TABLE enforcement_log
         ADD COLUMN backend TEXT NOT NULL DEFAULT 'router'`,
    );
    await queryRunner.query(
      `ALTER TABLE enforcement_log ALTER COLUMN backend DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE enforcement_log
         ADD CONSTRAINT enforcement_log_backend_check
         CHECK (backend IN ('router', 'pihole'))`,
    );

    // Rename ip_address → target_address: now holds either a CSV of IPs
    // (router) or a single MAC (pihole).
    await queryRunner.query(
      `ALTER TABLE enforcement_log RENAME COLUMN ip_address TO target_address`,
    );

    // Drop the old action check, rewrite values to the new verbs, then add
    // the new check.
    await queryRunner.query(
      `ALTER TABLE enforcement_log DROP CONSTRAINT IF EXISTS enforcement_log_action_check`,
    );
    await queryRunner.query(
      `UPDATE enforcement_log SET action='add' WHERE action='disable'`,
    );
    await queryRunner.query(
      `UPDATE enforcement_log SET action='del' WHERE action='enable'`,
    );
    await queryRunner.query(
      `ALTER TABLE enforcement_log
         ADD CONSTRAINT enforcement_log_action_check
         CHECK (action IN ('add', 'del'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE enforcement_log DROP CONSTRAINT IF EXISTS enforcement_log_action_check`,
    );
    await queryRunner.query(
      `UPDATE enforcement_log SET action='disable' WHERE action='add'`,
    );
    await queryRunner.query(
      `UPDATE enforcement_log SET action='enable' WHERE action='del'`,
    );
    await queryRunner.query(
      `ALTER TABLE enforcement_log
         ADD CONSTRAINT enforcement_log_action_check
         CHECK (action IN ('enable', 'disable'))`,
    );
    await queryRunner.query(
      `ALTER TABLE enforcement_log RENAME COLUMN target_address TO ip_address`,
    );
    await queryRunner.query(
      `ALTER TABLE enforcement_log DROP CONSTRAINT IF EXISTS enforcement_log_backend_check`,
    );
    await queryRunner.query(
      `ALTER TABLE enforcement_log DROP COLUMN backend`,
    );
  }
}
