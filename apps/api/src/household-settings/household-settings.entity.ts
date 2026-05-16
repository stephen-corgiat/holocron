import {
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'household_settings' })
export class HouseholdSettingsEntity {
  @PrimaryColumn({ name: 'id', type: 'int', default: 1 })
  id!: 1;

  // Postgres INTERVAL round-trips through node-postgres as a `PostgresInterval`
  // object; we keep it on the wire as an ISO-8601 duration string ("PT48H") to
  // dodge that and let the service do the math itself.
  @Column({
    name: 'pending_review_timeout',
    type: 'interval',
    default: "INTERVAL '48 hours'",
  })
  pendingReviewTimeout!: string | object;

  @Column({ name: 'time_zone', type: 'text', default: 'America/Los_Angeles' })
  timeZone!: string;

  // HH:MM 24-hour string (`20:00`) or NULL to disable the audible warning.
  @Column({ name: 'audible_warning_at', type: 'text', nullable: true })
  audibleWarningAt!: string | null;

  // ISO date (YYYY-MM-DD) of the last successful warning fire, for
  // once-per-household-day idempotency.
  @Column({
    name: 'audible_warning_last_fired_on',
    type: 'date',
    nullable: true,
  })
  audibleWarningLastFiredOn!: string | null;

  // Dollars-per-point conversion for cash-out display. The ledger stays in
  // points; this rate is for UI only.
  @Column({
    name: 'cash_out_rate',
    type: 'numeric',
    precision: 10,
    scale: 4,
    default: 0.1,
    transformer: {
      to: (v: number): number => v,
      from: (v: string | number | null): number =>
        v === null || v === undefined ? 0.1 : Number(v),
    },
  })
  cashOutRate!: number;

  // Points awarded on a qualifying Daily-routine-streak advance. `0` disables
  // the bonus entirely. Whole points only — the ledger is integer-valued.
  @Column({ name: 'daily_bonus_amount', type: 'int', default: 5 })
  dailyBonusAmount!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
