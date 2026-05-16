import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { HouseholdSettingsService } from './household-settings.service';

export interface PublicSettingsView {
  /** Household civil-time zone — drives all wall-clock rendering on the tablet. */
  time_zone: string;
}

/**
 * Display-only settings readable by any authenticated session (including the
 * wall-tablet token, which is not an admin). Exposes just the fields the
 * tablet UI needs to render times in the household zone — never the
 * admin-only configuration the {@link HouseholdSettingsController} returns.
 */
@Controller('settings')
@UseGuards(JwtAuthGuard)
export class PublicSettingsController {
  constructor(private readonly settings: HouseholdSettingsService) {}

  @Get('public')
  async get(): Promise<PublicSettingsView> {
    return { time_zone: await this.settings.timeZone() };
  }
}
