import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-household-day uniqueness for occurrences.
 *
 * The original `uq_occ_task_user_day` keyed on `(scheduled_at AT TIME ZONE
 * 'UTC')::date`, which is the *UTC* calendar day — wrong whenever the household
 * time zone isn't UTC (a single household day can straddle two UTC dates and
 * vice-versa). We replace it with an app-maintained `local_day` column holding
 * the household-local civil day of `scheduled_at`, and make uniqueness key on
 * that.
 *
 * `local_day` is written by the occurrence generator using the household tz at
 * insert time (see OccurrencesService). The backfill below seeds existing rows
 * from the household's currently-configured zone.
 */
export class OccurrenceLocalDay1717300000000 implements MigrationInterface {
  name = 'OccurrenceLocalDay1717300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE occurrences ADD COLUMN IF NOT EXISTS local_day DATE`,
    );

    // Seed from the household's configured zone. `AT TIME ZONE <iana>` turns a
    // timestamptz into the wall-clock timestamp in that zone; ::date is then
    // the civil day.
    await queryRunner.query(`
      UPDATE occurrences o
         SET local_day = (
           o.scheduled_at AT TIME ZONE (
             SELECT COALESCE(time_zone, 'America/Los_Angeles')
               FROM household_settings
              LIMIT 1
           )
         )::date
       WHERE local_day IS NULL
    `);

    await queryRunner.query(
      `ALTER TABLE occurrences ALTER COLUMN local_day SET NOT NULL`,
    );

    // Swap the UTC-day uniqueness for household-day uniqueness. If pre-existing
    // rows collide on (task_id, user_id, local_day) this will fail loudly —
    // that means real duplicate occurrences exist for a household day and need
    // manual reconciliation before re-running.
    await queryRunner.query(`DROP INDEX IF EXISTS uq_occ_task_user_day`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_occ_task_user_day
         ON occurrences (task_id, user_id, local_day)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_occ_task_user_day`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_occ_task_user_day
         ON occurrences (task_id, user_id, ((scheduled_at AT TIME ZONE 'UTC')::date))`,
    );
    await queryRunner.query(
      `ALTER TABLE occurrences DROP COLUMN IF EXISTS local_day`,
    );
  }
}
