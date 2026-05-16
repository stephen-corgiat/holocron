import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { TransactionEntity, TransactionKind } from './transaction.entity';

export interface AppendTransactionInput {
  userId: string;
  kind: TransactionKind;
  amount: number;
  reason?: string | null;
  adminUserId?: string | null;
  occurrenceId?: string | null;
  goalCompletionId?: string | null;
}

export interface HistoryFilter {
  /**
   * `earned` and `spent` are UI buckets — `earned` covers `earn`,
   * `spent` covers `penalty | withdrawal`. A single explicit `kind` is also
   * supported for unit-test convenience.
   */
  bucket?: 'all' | 'earned' | 'spent';
  kind?: TransactionKind;
  limit?: number;
  from?: Date;
  to?: Date;
}

const EARNED_KINDS: TransactionKind[] = ['earn'];
const SPENT_KINDS: TransactionKind[] = ['penalty', 'withdrawal'];

/**
 * Append-only ledger. There is no update path on purpose — corrections
 * land as new rows (e.g. a future `claw_back` kind) so balance derivation
 * stays a pure SUM over signed amounts.
 */
@Injectable()
export class TransactionsService {
  constructor(
    @InjectRepository(TransactionEntity)
    private readonly txns: Repository<TransactionEntity>,
  ) {}

  async append(input: AppendTransactionInput): Promise<TransactionEntity> {
    const entity = this.txns.create({
      userId: input.userId,
      kind: input.kind,
      amount: input.amount,
      reason: input.reason ?? null,
      adminUserId: input.adminUserId ?? null,
      occurrenceId: input.occurrenceId ?? null,
      goalCompletionId: input.goalCompletionId ?? null,
    });
    return this.txns.save(entity);
  }

  async balanceFor(userId: string): Promise<number> {
    const result = (await this.txns
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.amount), 0)', 'sum')
      .where('t.user_id = :userId', { userId })
      .getRawOne()) as { sum: string | number | null } | undefined;
    if (!result) return 0;
    const raw = result.sum;
    if (raw === null || raw === undefined) return 0;
    return typeof raw === 'number' ? raw : Number(raw);
  }

  async historyFor(
    userId: string,
    filter: HistoryFilter = {},
  ): Promise<TransactionEntity[]> {
    const where: {
      userId: string;
      kind?: TransactionKind | ReturnType<typeof In<TransactionKind>>;
      createdAt?: ReturnType<typeof Between<Date>>
        | ReturnType<typeof MoreThanOrEqual<Date>>
        | ReturnType<typeof LessThanOrEqual<Date>>;
    } = { userId };
    if (filter.kind) {
      where.kind = filter.kind;
    } else if (filter.bucket === 'earned') {
      where.kind = In(EARNED_KINDS);
    } else if (filter.bucket === 'spent') {
      where.kind = In(SPENT_KINDS);
    }
    if (filter.from && filter.to) {
      where.createdAt = Between(filter.from, filter.to);
    } else if (filter.from) {
      where.createdAt = MoreThanOrEqual(filter.from);
    } else if (filter.to) {
      where.createdAt = LessThanOrEqual(filter.to);
    }
    return this.txns.find({
      where,
      order: { createdAt: 'DESC' },
      take: filter.limit ?? 200,
    });
  }
}
