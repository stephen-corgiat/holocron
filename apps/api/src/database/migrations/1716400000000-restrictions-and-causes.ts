import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Restrictions + Causes + Restriction merge engine (ADR-0004).
 *
 * A Restriction is a block on a Restrictable Trackee's access to one scope
 * (internet | entertainment | games), with a non-empty list of Causes. At
 * most one active Restriction per (Trackee, scope) — enforced via a partial
 * unique index keyed off `lifted_at IS NULL`.
 *
 * Cause kinds:
 *   miss  — emitted by the Miss-engine when a tier's restriction spec fires.
 *   admin — emitted by the "Block now" admin action. Parent-only on both
 *     dimensions (no contributed auto-expiry, no contributed remediation).
 *
 * `effective_*` columns are denormalised from the cause list for read paths;
 * the merge engine recomputes them on every mutation.
 *
 * `remediation_requests` records "Ask a parent" requests from the tablet —
 * they surface in admin pending review but carry no lift effect.
 */
export class RestrictionsAndCauses1716400000000 implements MigrationInterface {
  name = 'RestrictionsAndCauses1716400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS restrictions (
        id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id                       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        scope                         TEXT NOT NULL CHECK (
          scope IN ('internet', 'entertainment', 'games')
        ),
        effective_expires_at          TIMESTAMPTZ,
        effective_remediation_goals   JSONB NOT NULL DEFAULT '[]'::jsonb,
        lifted_at                     TIMESTAMPTZ,
        created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS restrictions_active_unique
        ON restrictions (user_id, scope)
        WHERE lifted_at IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS restriction_causes (
        id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        restriction_id                  UUID NOT NULL REFERENCES restrictions(id) ON DELETE CASCADE,
        kind                            TEXT NOT NULL CHECK (kind IN ('miss', 'admin')),
        occurrence_id                   UUID REFERENCES occurrences(id) ON DELETE SET NULL,
        admin_user_id                   UUID REFERENCES users(id) ON DELETE SET NULL,
        reason                          TEXT,
        contributed_expires_at          TIMESTAMPTZ,
        contributed_remediation_goals   JSONB,
        parent_only_on_expiry           BOOLEAN NOT NULL DEFAULT FALSE,
        parent_only_on_remediation      BOOLEAN NOT NULL DEFAULT FALSE,
        created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS restriction_causes_restriction_id_idx
        ON restriction_causes (restriction_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS remediation_requests (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        restriction_id  UUID NOT NULL REFERENCES restrictions(id) ON DELETE CASCADE,
        scope           TEXT NOT NULL,
        note            TEXT,
        status          TEXT NOT NULL DEFAULT 'open' CHECK (
          status IN ('open', 'resolved')
        ),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at     TIMESTAMPTZ
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS remediation_requests_open_idx
        ON remediation_requests (status, created_at)
        WHERE status = 'open'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS remediation_requests`);
    await queryRunner.query(`DROP TABLE IF EXISTS restriction_causes`);
    await queryRunner.query(`DROP TABLE IF EXISTS restrictions`);
  }
}
