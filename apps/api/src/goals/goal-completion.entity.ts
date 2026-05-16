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
import { GoalEntity } from './goal.entity';

@Entity({ name: 'goal_completions' })
@Index(['goalId', 'userId', 'completedAt'])
export class GoalCompletionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => GoalEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'goal_id' })
  goal!: GoalEntity;

  @Column({ name: 'goal_id', type: 'uuid' })
  goalId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'tier_value', type: 'int' })
  tierValue!: number;

  @Column({
    name: 'remediation_for_restriction_id',
    type: 'uuid',
    nullable: true,
  })
  remediationForRestrictionId!: string | null;

  @CreateDateColumn({ name: 'completed_at', type: 'timestamptz' })
  completedAt!: Date;
}
