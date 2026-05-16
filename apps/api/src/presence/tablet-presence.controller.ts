import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { CLOCK, Clock } from '../clock/clock';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PresenceService } from './presence.service';
import { isHome } from './presence-resolver';
import { OneOffWindow } from './presence.entity';
import {
  DEFAULT_TIME_ZONE,
  HouseholdSettingsService,
} from '../household-settings/household-settings.service';
import { isoDateInTz } from '../clock/tz';

export interface TabletPresenceView {
  user_id: string;
  is_home: boolean;
  next_vacation: OneOffWindow | null;
}

/**
 * Tablet-facing presence summary.
 *
 * Returns the current is_home flag and the next upcoming one-off vacation
 * window (start date >= today) for the active Trackee. Used to drive the
 * "You're away" banner and the "Next time away" left-rail card.
 */
@Controller('presence')
@UseGuards(JwtAuthGuard)
export class TabletPresenceController {
  constructor(
    private readonly presence: PresenceService,
    private readonly settings: HouseholdSettingsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get('trackee/:userId')
  async forTrackee(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<TabletPresenceView> {
    const schedule = await this.presence
      .findByUserId(userId)
      .catch(() => null);
    if (!schedule) {
      return { user_id: userId, is_home: true, next_vacation: null };
    }
    const now = this.clock.now();
    const tz = await this.settings.timeZone().catch(() => DEFAULT_TIME_ZONE);
    const today = isoDateInTz(now, tz);
    const upcoming = (schedule.oneOffWindows ?? [])
      .filter((w) => w.end >= today)
      .sort((a, b) => a.start.localeCompare(b.start));
    return {
      user_id: userId,
      is_home: isHome(schedule, now, tz),
      next_vacation: upcoming[0] ?? null,
    };
  }
}
