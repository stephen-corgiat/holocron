import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { HouseholdSettingsService } from '../household-settings/household-settings.service';
import { TransactionsService } from './transactions.service';
import { CashOutService } from './cash-out.service';
import {
  AdjustBalanceDto,
  AdminCashOutDto,
  CashOutRequestView,
  TabletCashOutRequestDto,
  TransactionView,
} from './dto';
import { TransactionEntity, TransactionKind } from './transaction.entity';
import { CashOutRequestEntity } from './cash-out-request.entity';

@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(
    private readonly txns: TransactionsService,
    private readonly cashOut: CashOutService,
    private readonly settings: HouseholdSettingsService,
  ) {}

  @Get('trackee/:userId/balance')
  async balance(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{
    user_id: string;
    balance: number;
    cash_out_rate: number;
    pending_cash_out: boolean;
  }> {
    const [balance, cashOutRate, pending] = await Promise.all([
      this.txns.balanceFor(userId),
      this.settings.cashOutRate(),
      this.cashOut.hasPendingRequest(userId),
    ]);
    return {
      user_id: userId,
      balance,
      cash_out_rate: cashOutRate,
      pending_cash_out: pending,
    };
  }

  @Get('trackee/:userId/history')
  async history(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('bucket') bucket?: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<{ transactions: TransactionView[] }> {
    const allowed: Array<'all' | 'earned' | 'spent'> = [
      'all',
      'earned',
      'spent',
    ];
    const filterBucket = allowed.includes(bucket as 'all' | 'earned' | 'spent')
      ? (bucket as 'all' | 'earned' | 'spent')
      : 'all';
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    if (fromDate && Number.isNaN(fromDate.getTime())) {
      throw new BadRequestException('invalid "from" timestamp');
    }
    if (toDate && Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('invalid "to" timestamp');
    }
    const rows = await this.txns.historyFor(userId, {
      bucket: filterBucket,
      limit: limit ? Number(limit) : 200,
      from: fromDate,
      to: toDate,
    });
    return { transactions: rows.map(toView) };
  }

  @Post('cash-out/request')
  async createCashOutRequest(
    @Body() dto: TabletCashOutRequestDto,
  ): Promise<{ id: string; status: 'pending' }> {
    const row = await this.cashOut.createRequest(dto.user_id, dto.amount);
    return { id: row.id, status: 'pending' };
  }
}

@Controller('admin/transactions')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminTransactionsController {
  constructor(private readonly cashOut: CashOutService) {}

  @Post('adjust')
  async adjustBalance(
    @Body() dto: AdjustBalanceDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<TransactionView> {
    const adminUserId = adminIdOf(req);
    if (!adminUserId) throw new BadRequestException('admin session required');
    const txn = await this.cashOut.adminAdjust(
      dto.user_id,
      dto.amount,
      dto.reason ?? null,
      adminUserId,
    );
    return toView(txn);
  }

  @Post('cash-out/commit')
  async adminCashOut(
    @Body() dto: AdminCashOutDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<TransactionView> {
    const adminUserId = adminIdOf(req);
    if (!adminUserId) throw new BadRequestException('admin session required');
    const txn = await this.cashOut.adminCashOut(
      dto.user_id,
      dto.amount,
      adminUserId,
    );
    return toView(txn);
  }

  @Get('cash-out/requests')
  async listPending(): Promise<{ requests: CashOutRequestView[] }> {
    const rows = await this.cashOut.listPendingRequests();
    return { requests: rows.map(toRequestView) };
  }

  @Post('cash-out/requests/:id/commit')
  async commitRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<TransactionView> {
    const adminUserId = adminIdOf(req);
    if (!adminUserId) throw new BadRequestException('admin session required');
    const txn = await this.cashOut.commitRequest(id, adminUserId);
    return toView(txn);
  }

  @Post('cash-out/requests/:id/reject')
  async rejectRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<CashOutRequestView> {
    const adminUserId = adminIdOf(req);
    if (!adminUserId) throw new BadRequestException('admin session required');
    const row = await this.cashOut.rejectRequest(id, adminUserId);
    return toRequestView(row);
  }
}

function toView(t: TransactionEntity): TransactionView {
  return {
    id: t.id,
    user_id: t.userId,
    kind: t.kind as TransactionKind,
    amount: t.amount,
    reason: t.reason,
    admin_user_id: t.adminUserId,
    occurrence_id: t.occurrenceId,
    goal_completion_id: t.goalCompletionId,
    created_at: t.createdAt.toISOString(),
  };
}

function toRequestView(r: CashOutRequestEntity): CashOutRequestView {
  return {
    id: r.id,
    user_id: r.userId,
    user_display_name: r.user?.displayName ?? '',
    requested_amount: r.requestedAmount,
    status: r.status,
    admin_user_id: r.adminUserId,
    committed_transaction_id: r.committedTransactionId,
    decided_at: r.decidedAt?.toISOString() ?? null,
    created_at: r.createdAt.toISOString(),
  };
}

function adminIdOf(req: AuthenticatedRequest): string {
  const s = req.session;
  if (!s || s.kind !== 'admin') return '';
  return s.sub;
}
