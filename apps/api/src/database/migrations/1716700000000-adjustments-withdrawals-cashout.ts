import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adjustments, Withdrawals, Cash-out queue.
 *
 * - Widen the transactions CHECK constraint to include `adjustment` and
 *   `withdrawal`. Both are signed-amount ledger rows. `adjustment` carries
 *   no streak/ladder/restriction side-effects — purely a ledger move.
 *   `withdrawal` is the on-the-ledger record of an out-of-band cash-out.
 * - `cash_out_requests` records pending tablet-side cash-out requests until
 *   the admin commits or rejects them.
 * - `household_settings.cash_out_rate` exposes the points→dollars conversion
 *   for the UI (display-only — the ledger always stays in points).
 */
export class AdjustmentsWithdrawalsCashout1716700000000
  implements MigrationInterface
{
  name = 'AdjustmentsWithdrawalsCashout1716700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_kind_check`,
    );
    await queryRunner.query(
      `ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check
       CHECK (kind IN ('earn', 'penalty', 'claw_back', 'adjustment', 'withdrawal'))`,
    );

    await queryRunner.query(
      `ALTER TABLE household_settings
       ADD COLUMN IF NOT EXISTS cash_out_rate NUMERIC(10, 4) NOT NULL DEFAULT 0.10`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS cash_out_requests (
        id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        requested_amount         INT NOT NULL CHECK (requested_amount > 0),
        status                   TEXT NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'committed', 'rejected')),
        admin_user_id            UUID REFERENCES users(id) ON DELETE SET NULL,
        committed_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
        decided_at               TIMESTAMPTZ,
        created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS cash_out_requests_user_idx
       ON cash_out_requests (user_id, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS cash_out_requests_pending_idx
       ON cash_out_requests (status) WHERE status = 'pending'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS cash_out_requests`);
    await queryRunner.query(
      `ALTER TABLE household_settings DROP COLUMN IF EXISTS cash_out_rate`,
    );
    await queryRunner.query(
      `ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_kind_check`,
    );
    await queryRunner.query(
      `ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check
       CHECK (kind IN ('earn', 'penalty', 'claw_back'))`,
    );
  }
}
