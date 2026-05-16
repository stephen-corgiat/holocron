import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CLOCK, Clock } from '../clock/clock';
import { CashOutRequestEntity } from './cash-out-request.entity';
import { TransactionEntity } from './transaction.entity';
import { TransactionsService } from './transactions.service';
import { RealtimeBus } from '../realtime/realtime-bus';
import { UserEntity } from '../users/user.entity';

@Injectable()
export class CashOutService {
  private readonly logger = new Logger('CashOutService');

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CashOutRequestEntity)
    private readonly requests: Repository<CashOutRequestEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly txns: TransactionsService,
    private readonly bus: RealtimeBus,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Admin-direct cash-out. Commits a `withdrawal` transaction immediately
   * after re-validating the balance. Allows admins to cash out their own
   * balance.
   */
  async adminCashOut(
    userId: string,
    amount: number,
    adminUserId: string,
  ): Promise<TransactionEntity> {
    assertPositive(amount);
    await this.assertUserExists(userId);
    const balance = await this.txns.balanceFor(userId);
    this.assertBalanceCovers(balance, amount);
    const txn = await this.txns.append({
      userId,
      kind: 'withdrawal',
      amount: -amount,
      reason: 'cash out',
      adminUserId,
    });
    this.bus.emit({ kind: 'transactions:changed', userId: userId });
    this.logger.log(
      `admin cash-out user=${userId} amount=${amount} by=${adminUserId}`,
    );
    return txn;
  }

  /**
   * Admin Adjust Balance — a signed-amount ledger move with no side effects
   * on streak / ladder / restriction. Reason optional. Self-adjust allowed.
   */
  async adminAdjust(
    userId: string,
    amount: number,
    reason: string | null,
    adminUserId: string,
  ): Promise<TransactionEntity> {
    if (!Number.isInteger(amount) || amount === 0) {
      throw new BadRequestException('amount must be a non-zero integer');
    }
    await this.assertUserExists(userId);
    const txn = await this.txns.append({
      userId,
      kind: 'adjustment',
      amount,
      reason: reason && reason.trim().length > 0 ? reason.trim() : null,
      adminUserId,
    });
    this.bus.emit({ kind: 'transactions:changed', userId: userId });
    this.logger.log(
      `adjustment user=${userId} amount=${amount} by=${adminUserId}`,
    );
    return txn;
  }

  /**
   * Tablet-side: queue a cash-out request. No ledger effect until an admin
   * commits.
   */
  async createRequest(
    userId: string,
    amount: number,
  ): Promise<CashOutRequestEntity> {
    assertPositive(amount);
    await this.assertUserExists(userId);
    const existing = await this.requests.findOne({
      where: { userId, status: 'pending' },
    });
    if (existing) {
      throw new ConflictException(
        'a cash-out request is already pending — wait for a parent to decide',
      );
    }
    const balance = await this.txns.balanceFor(userId);
    this.assertBalanceCovers(balance, amount);
    const row = await this.requests.save(
      this.requests.create({
        userId,
        requestedAmount: amount,
        status: 'pending',
      }),
    );
    this.bus.emit({ kind: 'transactions:changed', userId: userId });
    return row;
  }

  async hasPendingRequest(userId: string): Promise<boolean> {
    const row = await this.requests.findOne({
      where: { userId, status: 'pending' },
    });
    return row !== null;
  }

  async listPendingRequests(): Promise<CashOutRequestEntity[]> {
    return this.requests.find({
      where: { status: 'pending' },
      relations: { user: true },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Admin commit on a pending request — posts the `withdrawal` transaction
   * with the request's amount (re-validated against current balance) and
   * transitions the request to `committed`.
   */
  async commitRequest(
    requestId: string,
    adminUserId: string,
  ): Promise<TransactionEntity> {
    let committedTxn!: TransactionEntity;
    let userId!: string;
    await this.dataSource.transaction(async (trx) => {
      const reqRepo = trx.getRepository(CashOutRequestEntity);
      const row = await reqRepo.findOne({ where: { id: requestId } });
      if (!row) {
        throw new NotFoundException(`cash-out request ${requestId} not found`);
      }
      if (row.status !== 'pending') {
        throw new BadRequestException(
          `cash-out request ${requestId} is ${row.status}`,
        );
      }
      const balance = await this.txns.balanceFor(row.userId);
      this.assertBalanceCovers(balance, row.requestedAmount);

      const txn = await this.txns.append({
        userId: row.userId,
        kind: 'withdrawal',
        amount: -row.requestedAmount,
        reason: 'cash out',
        adminUserId,
      });

      row.status = 'committed';
      row.adminUserId = adminUserId;
      row.committedTransactionId = txn.id;
      row.decidedAt = this.clock.now();
      await reqRepo.save(row);
      committedTxn = txn;
      userId = row.userId;
    });
    this.bus.emit({ kind: 'transactions:changed', userId: userId });
    this.logger.log(
      `committed cash-out request=${requestId} by=${adminUserId}`,
    );
    return committedTxn;
  }

  async rejectRequest(
    requestId: string,
    adminUserId: string,
  ): Promise<CashOutRequestEntity> {
    const row = await this.requests.findOne({ where: { id: requestId } });
    if (!row) {
      throw new NotFoundException(`cash-out request ${requestId} not found`);
    }
    if (row.status !== 'pending') {
      throw new BadRequestException(
        `cash-out request ${requestId} is ${row.status}`,
      );
    }
    row.status = 'rejected';
    row.adminUserId = adminUserId;
    row.decidedAt = this.clock.now();
    await this.requests.save(row);
    this.bus.emit({ kind: 'transactions:changed', userId: row.userId });
    this.logger.log(
      `rejected cash-out request=${requestId} by=${adminUserId}`,
    );
    return row;
  }

  private assertBalanceCovers(balance: number, amount: number): void {
    if (balance < 0) {
      throw new BadRequestException(
        `cash out blocked: balance is negative (${balance})`,
      );
    }
    if (amount > balance) {
      throw new ConflictException(
        `requested ${amount} exceeds current balance ${balance}`,
      );
    }
  }

  private async assertUserExists(userId: string): Promise<void> {
    const u = await this.users.findOne({ where: { id: userId } });
    if (!u) throw new BadRequestException(`user ${userId} not found`);
  }
}

function assertPositive(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new BadRequestException('amount must be a positive integer');
  }
}
