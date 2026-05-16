import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  NotEquals,
  Min,
} from 'class-validator';

export class AdjustBalanceDto {
  @IsUUID()
  user_id!: string;

  @IsInt()
  @NotEquals(0)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AdminCashOutDto {
  @IsUUID()
  user_id!: string;

  @IsInt()
  @Min(1)
  amount!: number;
}

export class TabletCashOutRequestDto {
  @IsUUID()
  user_id!: string;

  @IsInt()
  @Min(1)
  amount!: number;
}

export interface TransactionView {
  id: string;
  user_id: string;
  kind: 'earn' | 'penalty' | 'claw_back' | 'adjustment' | 'withdrawal';
  amount: number;
  reason: string | null;
  admin_user_id: string | null;
  occurrence_id: string | null;
  goal_completion_id: string | null;
  created_at: string;
}

export interface CashOutRequestView {
  id: string;
  user_id: string;
  user_display_name: string;
  requested_amount: number;
  status: 'pending' | 'committed' | 'rejected';
  admin_user_id: string | null;
  committed_transaction_id: string | null;
  decided_at: string | null;
  created_at: string;
}
