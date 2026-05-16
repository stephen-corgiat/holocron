import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  Max,
  ValidateIf,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import {
  HouseholdSettingsService,
  HouseholdSettingsView,
} from './household-settings.service';

/** Accepts any IANA zone the host's Intl database recognizes. */
@ValidatorConstraint({ name: 'isIanaTimeZone', async: false })
export class IsIanaTimeZone implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || value.trim() === '') return false;
    try {
      // Throws RangeError for an unknown zone.
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }
  defaultMessage(): string {
    return 'time_zone must be a valid IANA time zone (e.g. America/Los_Angeles)';
  }
}

export class UpdateHouseholdSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0.0833) // 5 minutes — floor so the sweeper can do something useful
  @Max(720) // 30 days
  pending_review_timeout_hours?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  cash_out_rate?: number;

  @IsOptional()
  @IsInt()
  @Min(0) // 0 disables the streak bonus
  @Max(1000)
  daily_bonus_amount?: number;

  @IsOptional()
  @IsString()
  @Validate(IsIanaTimeZone)
  time_zone?: string;

  /**
   * HH:MM 24-hour string, or `null` / empty to disable the audible warning.
   */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'audible_warning_at must be HH:MM (24-hour)',
  })
  audible_warning_at?: string | null;
}

@Controller('admin/settings/household')
@UseGuards(JwtAuthGuard, AdminGuard)
export class HouseholdSettingsController {
  constructor(private readonly settings: HouseholdSettingsService) {}

  @Get()
  get(): Promise<HouseholdSettingsView> {
    return this.settings.view();
  }

  @Patch()
  async update(
    @Body() dto: UpdateHouseholdSettingsDto,
  ): Promise<HouseholdSettingsView> {
    if (
      dto.pending_review_timeout_hours === undefined &&
      dto.cash_out_rate === undefined &&
      dto.audible_warning_at === undefined &&
      dto.time_zone === undefined &&
      dto.daily_bonus_amount === undefined
    ) {
      throw new BadRequestException('no settings provided');
    }
    if (
      dto.pending_review_timeout_hours !== undefined &&
      !Number.isNaN(dto.pending_review_timeout_hours)
    ) {
      await this.settings.updateTimeoutHours(dto.pending_review_timeout_hours);
    }
    if (dto.time_zone !== undefined) {
      await this.settings.updateTimeZone(dto.time_zone);
    }
    if (
      dto.cash_out_rate !== undefined &&
      !Number.isNaN(dto.cash_out_rate)
    ) {
      await this.settings.updateCashOutRate(dto.cash_out_rate);
    }
    if (
      dto.daily_bonus_amount !== undefined &&
      !Number.isNaN(dto.daily_bonus_amount)
    ) {
      await this.settings.updateDailyBonusAmount(dto.daily_bonus_amount);
    }
    if (dto.audible_warning_at !== undefined) {
      const v =
        typeof dto.audible_warning_at === 'string' &&
        dto.audible_warning_at.trim() !== ''
          ? dto.audible_warning_at
          : null;
      await this.settings.updateAudibleWarningAt(v);
    }
    return this.settings.view();
  }
}
