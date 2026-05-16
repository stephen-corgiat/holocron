import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { RestrictionScope } from './restriction-merge';

export type EnforcementAction = 'add' | 'del';
export type EnforcementResult = 'ok' | 'error' | 'skipped';
export type EnforcementBackend = 'router' | 'pihole';

@Entity({ name: 'enforcement_log' })
export class EnforcementLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'restriction_id', type: 'uuid', nullable: true })
  restrictionId!: string | null;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'backend', type: 'text' })
  backend!: EnforcementBackend;

  @Column({ name: 'scope', type: 'text' })
  scope!: RestrictionScope;

  @Column({ name: 'action', type: 'text' })
  action!: EnforcementAction;

  /**
   * Comma-separated IP list when backend='router' (the new API takes
   * `ip=<csv>` in a single call); a single MAC address when
   * backend='pihole'. Null only on `result='skipped'` rows that record
   * "no addressable devices".
   */
  @Column({ name: 'target_address', type: 'text', nullable: true })
  targetAddress!: string | null;

  @Column({ name: 'result', type: 'text' })
  result!: EnforcementResult;

  @Column({ name: 'http_status', type: 'int', nullable: true })
  httpStatus!: number | null;

  @Column({ name: 'error', type: 'text', nullable: true })
  error!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
