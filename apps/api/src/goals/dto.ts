import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const LIMIT_WINDOWS = ['day', 'week', 'month', 'lifetime'] as const;
export type LimitWindowDto = (typeof LIMIT_WINDOWS)[number];

const GOAL_KINDS = ['flat', 'tiered'] as const;
export type GoalKindDto = (typeof GOAL_KINDS)[number];

export class CreateCategoryDto {
  @IsString()
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsInt()
  sort_order?: number;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsInt()
  sort_order?: number;
}

export class CreateGoalDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  icon?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string | null;

  @IsUUID()
  category_id!: string;

  @IsOptional()
  @IsIn(GOAL_KINDS)
  kind?: GoalKindDto;

  @IsOptional()
  @IsInt()
  @Min(0)
  points?: number;

  @ValidateIf((o) => o.kind === 'tiered')
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(1, { each: true })
  tier_values?: number[];

  @IsInt()
  @Min(1)
  @Max(999)
  completion_limit!: number;

  @IsIn(LIMIT_WINDOWS)
  limit_window!: LimitWindowDto;

  @IsOptional()
  @IsBoolean()
  show_in_catalog?: boolean;

  @IsOptional()
  @IsBoolean()
  usable_as_remediation?: boolean;

  @IsOptional()
  @IsUUID()
  assigned_to_user_id?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  celebration_variant_id?: string | null;
}

export class UpdateGoalDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  icon?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string | null;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsIn(GOAL_KINDS)
  kind?: GoalKindDto;

  @IsOptional()
  @IsInt()
  @Min(0)
  points?: number;

  @ValidateIf((o) => o.kind === 'tiered')
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(1, { each: true })
  tier_values?: number[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  completion_limit?: number;

  @IsOptional()
  @IsIn(LIMIT_WINDOWS)
  limit_window?: LimitWindowDto;

  @IsOptional()
  @IsBoolean()
  show_in_catalog?: boolean;

  @IsOptional()
  @IsBoolean()
  usable_as_remediation?: boolean;

  @IsOptional()
  assigned_to_user_id?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  celebration_variant_id?: string | null;
}

export class CompleteGoalDto {
  @IsUUID()
  user_id!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  tier_value?: number;

  /**
   * Goal-as-remediation: when set, the completion lifts the matching active
   * Restriction (which must list this goal in its effective_remediation_goals).
   */
  @IsOptional()
  @IsUUID()
  restriction_id?: string;
}
