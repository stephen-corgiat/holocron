import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { TaskEntity } from './task.entity';

export type OccurrenceStatus =
  | 'active'
  | 'excused'
  | 'deferred'
  | 'complete'
  | 'missed'
  | 'pending_review';

@Entity({ name: 'occurrences' })
@Index(['user', 'scheduledAt'])
export class OccurrenceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => TaskEntity, (t) => t.occurrences, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task!: TaskEntity;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'scheduled_at', type: 'timestamptz' })
  scheduledAt!: Date;

  // Household-local civil day of `scheduled_at` (YYYY-MM-DD). App-maintained by
  // the generator using the household tz; backs the per-household-day
  // uniqueness index. Stored as a SQL DATE (string at the driver boundary).
  @Column({ name: 'local_day', type: 'date' })
  localDay!: string;

  // Windowed-task deadline. For kind='windowed', this is the end of the
  // window and the moment the Miss-engine fires. For other kinds, NULL.
  // scheduled_at carries window_start for windowed occurrences, doubling
  // as the tablet's "visible after" gate.
  @Column({ name: 'window_end', type: 'timestamptz', nullable: true })
  windowEnd!: Date | null;

  @Column({ name: 'status', type: 'text', default: 'active' })
  status!: OccurrenceStatus;

  @Column({ name: 'pending_since', type: 'timestamptz', nullable: true })
  pendingSince!: Date | null;

  @Column({
    name: 'deferred_from_occurrence_id',
    type: 'uuid',
    nullable: true,
  })
  deferredFromOccurrenceId!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
