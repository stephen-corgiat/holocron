import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { RestrictionCauseEntity } from './restriction-cause.entity';
import { RestrictionScope } from './restriction-merge';

@Entity({ name: 'restrictions' })
@Index(['userId', 'scope'])
export class RestrictionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'scope', type: 'text' })
  scope!: RestrictionScope;

  @Column({ name: 'effective_expires_at', type: 'timestamptz', nullable: true })
  effectiveExpiresAt!: Date | null;

  @Column({
    name: 'effective_remediation_goals',
    type: 'jsonb',
    default: () => `'[]'::jsonb`,
  })
  effectiveRemediationGoals!: string[];

  @Column({ name: 'lifted_at', type: 'timestamptz', nullable: true })
  liftedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => RestrictionCauseEntity, (c) => c.restriction)
  causes!: RestrictionCauseEntity[];
}
