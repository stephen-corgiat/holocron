import {
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { OccurrenceEntity } from './occurrence.entity';
import { RecurrencePattern } from './recurrence';
import { Ladder } from './resolution';

export type TaskKind = 'reminder' | 'recurring' | 'windowed';

@Entity({ name: 'tasks' })
export class TaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'kind', type: 'text' })
  kind!: TaskKind;

  @Column({ name: 'name', type: 'text' })
  name!: string;

  @Column({ name: 'icon', type: 'text', nullable: true })
  icon!: string | null;

  // Postgres TIME comes back as 'HH:MM:SS' — kept as string to avoid timezone
  // ambiguity. It's a wall-clock time in the household timezone (ADR-0007),
  // combined with each occurrence date by `combineDateAndDueTime`.
  @Column({ name: 'due_time', type: 'time' })
  dueTime!: string;

  @Column({ name: 'recurrence', type: 'jsonb', nullable: true })
  recurrence!: RecurrencePattern | null;

  @Column({ name: 'points', type: 'int', default: 0 })
  points!: number;

  @Column({
    name: 'ladder',
    type: 'jsonb',
    default: () => `'[{"points": 1, "restriction": null}]'::jsonb`,
  })
  ladder!: Ladder;

  @Column({ name: 'ladder_reset_threshold', type: 'int', default: 3 })
  ladderResetThreshold!: number;

  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'requires_verification', type: 'boolean', default: false })
  requiresVerification!: boolean;

  @Column({ name: 'allow_late_completion', type: 'boolean', default: true })
  allowLateCompletion!: boolean;

  // Minutes after due_time during which a missed occurrence can be late-
  // completed (ADR-0001). Default 12h; ignored when allow_late_completion=false.
  @Column({ name: 'late_window_minutes', type: 'int', default: 720 })
  lateWindowMinutes!: number;

  // Windowed task (kind='windowed', recurring case): durations in minutes
  // from the cadence anchor (local midnight on each cadence-hit date) used
  // to compute window_start and window_end on each materialized occurrence.
  // Both NULL for non-windowed tasks and for one-shot windowed tasks (their
  // window is stored directly on the single materialized occurrence).
  @Column({ name: 'window_start_offset_minutes', type: 'int', nullable: true })
  windowStartOffsetMinutes!: number | null;

  @Column({ name: 'window_end_offset_minutes', type: 'int', nullable: true })
  windowEndOffsetMinutes!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToMany(() => UserEntity)
  @JoinTable({
    name: 'task_assignments',
    joinColumn: { name: 'task_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'user_id', referencedColumnName: 'id' },
  })
  assignees!: UserEntity[];

  @OneToMany(() => OccurrenceEntity, (o) => o.task)
  occurrences!: OccurrenceEntity[];
}
