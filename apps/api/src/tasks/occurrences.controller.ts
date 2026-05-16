import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CLOCK, Clock } from '../clock/clock';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OccurrencesService, OccurrenceView } from './occurrences.service';
import { OccurrenceActionsService } from './occurrence-actions.service';

interface CompleteOccurrenceResponse {
  id: string;
  status: 'complete';
}

@Controller('occurrences')
@UseGuards(JwtAuthGuard)
export class OccurrencesController {
  constructor(
    private readonly occurrences: OccurrencesService,
    private readonly actions: OccurrenceActionsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Reminder + recurring occurrences for one Trackee on one local-server
   * date. The tablet calls this for the currently-active tab.
   */
  @Get('trackee/:userId')
  async forTrackee(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('date') dateStr?: string,
  ): Promise<{ occurrences: OccurrenceView[] }> {
    const date = parseLocalDate(dateStr) ?? this.clock.now();
    const list = await this.occurrences.forTrackeeOnDate(userId, date, this.clock.now());
    return { occurrences: list };
  }

  /**
   * Windowed-task "Up next" rail. Returns windowed occurrences whose window
   * opens within the next 24h for the given Trackee, so the tablet can
   * surface them in the left rail before they become actionable.
   */
  @Get('trackee/:userId/up-next')
  async upNext(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ occurrences: OccurrenceView[] }> {
    const list = await this.occurrences.upNextWindowedForTrackee(userId, this.clock.now());
    return { occurrences: list };
  }

  @Post(':id/complete')
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CompleteOccurrenceResponse> {
    const occ = await this.occurrences.markComplete(id);
    return { id: occ.id, status: 'complete' };
  }

  /**
   * Late completion (ADR-0001). Full undo of a fired Miss: refunds the
   * penalty as a `claw_back`, retracts the ladder advance, and flips the
   * occurrence back to `complete` so the streak day is preserved.
   */
  @Post(':id/late-complete')
  async lateComplete(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CompleteOccurrenceResponse> {
    const occ = await this.actions.lateComplete(id);
    return { id: occ.id, status: 'complete' };
  }
}

function parseLocalDate(value?: string): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    12,
    0,
    0,
    0,
  );
  return Number.isNaN(d.getTime()) ? null : d;
}
