import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../users/user.entity';

export type RecurringRuleKind = 'none' | 'full_time' | 'n_week_grid';

/** One-off vacation window — always marks the Trackee as away. */
export interface OneOffWindow {
  /** ISO date `YYYY-MM-DD`, inclusive start. */
  start: string;
  /** ISO date `YYYY-MM-DD`, inclusive end. */
  end: string;
  /** Human-readable label, e.g. "Summer camp". */
  label: string;
}

/**
 * Per-Trackee residency schedule: a recurring rule ('none' / 'full_time' /
 * `n_week_grid`) plus layered `one_off_windows` (vacations).
 */
@Entity({ name: 'presence_schedules' })
export class PresenceScheduleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @OneToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId!: string;

  @Column({ name: 'recurring_rule_kind', type: 'text', default: 'none' })
  recurringRuleKind!: RecurringRuleKind;

  @Column({ name: 'grid_n_weeks', type: 'int', nullable: true })
  gridNWeeks!: number | null;

  @Column({ name: 'grid_cells', type: 'jsonb', nullable: true })
  gridCells!: unknown | null;

  @Column({ name: 'epoch_date', type: 'date', nullable: true })
  epochDate!: string | null;

  @Column({
    name: 'one_off_windows',
    type: 'jsonb',
    default: () => `'[]'::jsonb`,
  })
  oneOffWindows!: OneOffWindow[];

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
