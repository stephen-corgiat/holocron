import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { GoalEntity } from './goal.entity';

@Entity({ name: 'goal_favorites' })
@Index(['userId'])
export class GoalFavoriteEntity {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @PrimaryColumn({ name: 'goal_id', type: 'uuid' })
  goalId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @ManyToOne(() => GoalEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'goal_id' })
  goal!: GoalEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
