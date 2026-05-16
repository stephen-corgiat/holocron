import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TaskEntity } from './task.entity';
import { UserEntity } from '../users/user.entity';

@Entity({ name: 'ladder_positions' })
export class LadderPositionEntity {
  @PrimaryColumn({ name: 'task_id', type: 'uuid' })
  taskId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => TaskEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task!: TaskEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ name: 'position', type: 'int', default: 1 })
  position!: number;

  @Column({ name: 'clean_streak_count', type: 'int', default: 0 })
  cleanStreakCount!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
