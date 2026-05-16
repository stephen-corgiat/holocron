import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { OccurrenceEntity } from '../tasks/occurrence.entity';
import { GoalCompletionEntity } from '../goals/goal-completion.entity';

export type TransactionKind =
  | 'earn'
  | 'penalty'
  | 'claw_back'
  | 'adjustment'
  | 'withdrawal';

@Entity({ name: 'transactions' })
@Index(['userId', 'createdAt'])
export class TransactionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'kind', type: 'text' })
  kind!: TransactionKind;

  @Column({ name: 'amount', type: 'int' })
  amount!: number;

  @Column({ name: 'reason', type: 'text', nullable: true })
  reason!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'admin_user_id' })
  adminUser!: UserEntity | null;

  @Column({ name: 'admin_user_id', type: 'uuid', nullable: true })
  adminUserId!: string | null;

  @ManyToOne(() => OccurrenceEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'occurrence_id' })
  occurrence!: OccurrenceEntity | null;

  @Column({ name: 'occurrence_id', type: 'uuid', nullable: true })
  occurrenceId!: string | null;

  @Column({ name: 'txn_group_id', type: 'uuid', nullable: true })
  txnGroupId!: string | null;

  @ManyToOne(() => GoalCompletionEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'goal_completion_id' })
  goalCompletion!: GoalCompletionEntity | null;

  @Column({ name: 'goal_completion_id', type: 'uuid', nullable: true })
  goalCompletionId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
