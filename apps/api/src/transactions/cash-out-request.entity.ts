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
import { TransactionEntity } from './transaction.entity';

export type CashOutRequestStatus = 'pending' | 'committed' | 'rejected';

@Entity({ name: 'cash_out_requests' })
@Index(['userId', 'createdAt'])
export class CashOutRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'requested_amount', type: 'int' })
  requestedAmount!: number;

  @Column({ name: 'status', type: 'text', default: 'pending' })
  status!: CashOutRequestStatus;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'admin_user_id' })
  adminUser!: UserEntity | null;

  @Column({ name: 'admin_user_id', type: 'uuid', nullable: true })
  adminUserId!: string | null;

  @ManyToOne(() => TransactionEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'committed_transaction_id' })
  committedTransaction!: TransactionEntity | null;

  @Column({ name: 'committed_transaction_id', type: 'uuid', nullable: true })
  committedTransactionId!: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
