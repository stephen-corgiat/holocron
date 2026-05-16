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
import { RestrictionEntity } from './restriction.entity';
import { RestrictionScope } from './restriction-merge';

export type RemediationRequestStatus = 'open' | 'resolved';

@Entity({ name: 'remediation_requests' })
@Index(['status', 'createdAt'])
export class RemediationRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => RestrictionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restriction_id' })
  restriction!: RestrictionEntity;

  @Column({ name: 'restriction_id', type: 'uuid' })
  restrictionId!: string;

  @Column({ name: 'scope', type: 'text' })
  scope!: RestrictionScope;

  @Column({ name: 'note', type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'status', type: 'text', default: 'open' })
  status!: RemediationRequestStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;
}
