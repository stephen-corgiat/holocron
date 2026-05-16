import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RecurrencePattern } from './recurrence';

export class TierDto {
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  points!: number;

  // ADR-0004: a tier's Restriction spec carries the scope (`type`) plus the
  // two orthogonal lift-condition dimensions a MissCause contributes:
  // duration_minutes (auto-expiry, null/omitted = parent-only on this dim)
  // and remediation_goal_ids (null/empty = parent-only on this dim).
  @IsOptional()
  restriction?: {
    type: 'internet' | 'entertainment' | 'games';
    duration_minutes?: number | null;
    remediation_goal_ids?: string[] | null;
  } | null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateReminderTaskDto {
  // Discriminator is accepted but constrained to 'reminder' in this DTO.
  @IsOptional()
  @IsIn(['reminder'])
  kind?: 'reminder';

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string | null;

  @Matches(HHMM, { message: 'due_time must be HH:MM (24h)' })
  due_time!: string;

  // Reminders carry the same recurrence cadence as recurring tasks; the
  // engine validates the shape (see assertRecurrence). Omit/null = fire daily
  // (the legacy reminder behavior, kept for back-compat).
  @IsOptional()
  @IsObject()
  recurrence?: RecurrencePattern | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  assignee_ids!: string[];
}

export class UpdateReminderTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string | null;

  @IsOptional()
  @Matches(HHMM, { message: 'due_time must be HH:MM (24h)' })
  due_time?: string;

  @IsOptional()
  @IsObject()
  recurrence?: RecurrencePattern | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  assignee_ids?: string[];
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Windowed task — third kind. Two flavors:
 *  - recurring: `recurrence` + `window_start_offset_minutes` +
 *    `window_end_offset_minutes` (offsets from each cadence-hit local midnight).
 *  - one-shot: `window_start` + `window_end` ISO timestamps (no recurrence).
 *
 * `allow_late_completion` is forced to false for windowed tasks (the window
 * already provided the flex). The DTO accepts but ignores the field.
 */
export class CreateWindowedTaskDto {
  @IsOptional()
  @IsIn(['windowed'])
  kind?: 'windowed';

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string | null;

  @IsOptional()
  @IsObject()
  recurrence?: RecurrencePattern | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60 * 24 * 14)
  window_start_offset_minutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60 * 24 * 14)
  window_end_offset_minutes?: number;

  @IsOptional()
  @Matches(ISO_DATETIME, { message: 'window_start must be an ISO datetime' })
  window_start?: string;

  @IsOptional()
  @Matches(ISO_DATETIME, { message: 'window_end must be an ISO datetime' })
  window_end?: string;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  points!: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TierDto)
  ladder?: TierDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  ladder_reset_threshold?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  requires_verification?: boolean;

  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  assignee_ids!: string[];
}

export class UpdateWindowedTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string | null;

  @IsOptional()
  @IsObject()
  recurrence?: RecurrencePattern | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60 * 24 * 14)
  window_start_offset_minutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60 * 24 * 14)
  window_end_offset_minutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  points?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TierDto)
  ladder?: TierDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  ladder_reset_threshold?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  requires_verification?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  assignee_ids?: string[];
}

export class CreateRecurringTaskDto {
  @IsOptional()
  @IsIn(['recurring'])
  kind?: 'recurring';

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string | null;

  @Matches(HHMM, { message: 'due_time must be HH:MM (24h)' })
  due_time!: string;

  // Shape validation is deferred to the recurrence engine — class-validator
  // would need a switch-on-discriminator dance that's heavier than the value.
  @IsObject()
  recurrence!: RecurrencePattern;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  points!: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TierDto)
  ladder?: TierDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  ladder_reset_threshold?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  requires_verification?: boolean;

  @IsOptional()
  @IsBoolean()
  allow_late_completion?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60 * 24 * 14)
  late_window_minutes?: number;

  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  assignee_ids!: string[];
}

export class UpdateRecurringTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string | null;

  @IsOptional()
  @Matches(HHMM, { message: 'due_time must be HH:MM (24h)' })
  due_time?: string;

  @IsOptional()
  @IsObject()
  recurrence?: RecurrencePattern;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  points?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TierDto)
  ladder?: TierDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  ladder_reset_threshold?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  requires_verification?: boolean;

  @IsOptional()
  @IsBoolean()
  allow_late_completion?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60 * 24 * 14)
  late_window_minutes?: number;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  assignee_ids?: string[];
}
