import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { CategoryEntity } from './category.entity';

export type GoalKind = 'flat' | 'tiered';
export type LimitWindow = 'day' | 'week' | 'month' | 'lifetime';

@Entity({ name: 'goals' })
export class GoalEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'name', type: 'text' })
  name!: string;

  @Column({ name: 'icon', type: 'text', nullable: true })
  icon!: string | null;

  @Column({ name: 'note', type: 'text', nullable: true })
  note!: string | null;

  @ManyToOne(() => CategoryEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'category_id' })
  category!: CategoryEntity;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId!: string;

  @Column({ name: 'kind', type: 'text', default: 'flat' })
  kind!: GoalKind;

  @Column({ name: 'points', type: 'int', default: 0 })
  points!: number;

  @Column({ name: 'tier_values', type: 'jsonb', default: () => "'[]'::jsonb" })
  tierValues!: number[];

  @Column({ name: 'completion_limit', type: 'int', default: 1 })
  completionLimit!: number;

  @Column({ name: 'limit_window', type: 'text', default: 'day' })
  limitWindow!: LimitWindow;

  @Column({ name: 'show_in_catalog', type: 'boolean', default: true })
  showInCatalog!: boolean;

  @Column({ name: 'usable_as_remediation', type: 'boolean', default: false })
  usableAsRemediation!: boolean;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'assigned_to_user_id' })
  assignedToUser!: UserEntity | null;

  @Column({ name: 'assigned_to_user_id', type: 'uuid', nullable: true })
  assignedToUserId!: string | null;

  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;

  /**
   * Pins a celebration variant id; null → random pick at completion time.
   * The registry lives client-side, so no FK / enum is enforced here.
   */
  @Column({ name: 'celebration_variant_id', type: 'text', nullable: true })
  celebrationVariantId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
