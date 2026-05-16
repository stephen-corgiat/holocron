import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OccurrenceEntity } from '../tasks/occurrence.entity';
import { UserEntity } from '../users/user.entity';
import { RestrictionEntity } from './restriction.entity';
import { CauseKind } from './restriction-merge';

@Entity({ name: 'restriction_causes' })
export class RestrictionCauseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => RestrictionEntity, (r) => r.causes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restriction_id' })
  restriction!: RestrictionEntity;

  @Column({ name: 'restriction_id', type: 'uuid' })
  restrictionId!: string;

  @Column({ name: 'kind', type: 'text' })
  kind!: CauseKind;

  @ManyToOne(() => OccurrenceEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'occurrence_id' })
  occurrence!: OccurrenceEntity | null;

  @Column({ name: 'occurrence_id', type: 'uuid', nullable: true })
  occurrenceId!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'admin_user_id' })
  adminUser!: UserEntity | null;

  @Column({ name: 'admin_user_id', type: 'uuid', nullable: true })
  adminUserId!: string | null;

  @Column({ name: 'reason', type: 'text', nullable: true })
  reason!: string | null;

  @Column({
    name: 'contributed_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  contributedExpiresAt!: Date | null;

  @Column({
    name: 'contributed_remediation_goals',
    type: 'jsonb',
    nullable: true,
  })
  contributedRemediationGoals!: string[] | null;

  @Column({ name: 'parent_only_on_expiry', type: 'boolean', default: false })
  parentOnlyOnExpiry!: boolean;

  @Column({
    name: 'parent_only_on_remediation',
    type: 'boolean',
    default: false,
  })
  parentOnlyOnRemediation!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
