import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { PresenceService } from './presence.service';
import { OneOffWindow, RecurringRuleKind } from './presence.entity';
import type { GridCells } from './presence-resolver';

interface PresenceScheduleView {
  user_id: string;
  display_name: string;
  is_admin: boolean;
  is_restrictable: boolean;
  recurring_rule_kind: RecurringRuleKind;
  grid_n_weeks: number | null;
  epoch_date: string | null;
  grid_cells: GridCells | null;
  one_off_windows: OneOffWindow[];
}

interface UpdateBody {
  recurring_rule_kind?: string;
  grid_n_weeks?: number | null;
  epoch_date?: string | null;
  grid_cells?: unknown;
}

interface AddVacationsBody {
  windows: Array<{ start: string; end: string; label: string }>;
}

const ALLOWED_KINDS: RecurringRuleKind[] = ['none', 'full_time', 'n_week_grid'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;

@Controller('admin/presence')
@UseGuards(JwtAuthGuard, AdminGuard)
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Get()
  async list(): Promise<{ schedules: PresenceScheduleView[] }> {
    const rows = await this.presence.listWithUsers();
    return {
      schedules: rows.map(({ schedule, user }) => ({
        user_id: user.id,
        display_name: user.displayName,
        is_admin: user.isAdmin,
        is_restrictable: user.isRestrictable,
        recurring_rule_kind: schedule.recurringRuleKind,
        grid_n_weeks: schedule.gridNWeeks,
        epoch_date: schedule.epochDate,
        grid_cells: (schedule.gridCells as GridCells | null) ?? null,
        one_off_windows: schedule.oneOffWindows ?? [],
      })),
    };
  }

  @Patch(':userId')
  async update(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: UpdateBody,
  ): Promise<PresenceScheduleView> {
    const kind = body?.recurring_rule_kind;
    if (!kind || !ALLOWED_KINDS.includes(kind as RecurringRuleKind)) {
      throw new BadRequestException(
        `recurring_rule_kind must be one of ${ALLOWED_KINDS.join(', ')}`,
      );
    }

    let gridNWeeks: number | null = null;
    let epochDate: string | null = null;
    let gridCells: GridCells | null = null;
    if (kind === 'n_week_grid') {
      const n = body.grid_n_weeks;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 6) {
        throw new BadRequestException(
          'grid_n_weeks must be an integer in [1, 6]',
        );
      }
      const epoch = body.epoch_date;
      if (typeof epoch !== 'string' || !ISO_DATE.test(epoch)) {
        throw new BadRequestException('epoch_date must be ISO YYYY-MM-DD');
      }
      gridCells = validateGridCells(body.grid_cells, n);
      gridNWeeks = n;
      epochDate = epoch;
    }

    const schedule = await this.presence.update(userId, {
      recurringRuleKind: kind as RecurringRuleKind,
      gridNWeeks,
      epochDate,
      gridCells,
    });
    const user = schedule.user;
    return {
      user_id: userId,
      display_name: user?.displayName ?? '',
      is_admin: user?.isAdmin ?? false,
      is_restrictable: user?.isRestrictable ?? false,
      recurring_rule_kind: schedule.recurringRuleKind,
      grid_n_weeks: schedule.gridNWeeks,
      epoch_date: schedule.epochDate,
      grid_cells: (schedule.gridCells as GridCells | null) ?? null,
      one_off_windows: schedule.oneOffWindows ?? [],
    };
  }

  /** Bulk-add vacation windows for a Trackee. */
  @Post(':userId/vacations')
  async addVacations(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: AddVacationsBody,
  ): Promise<PresenceScheduleView> {
    const windows = body?.windows;
    if (!Array.isArray(windows) || windows.length === 0) {
      throw new BadRequestException('windows must be a non-empty array');
    }

    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    const validated: OneOffWindow[] = [];
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i];
      if (!w || typeof w !== 'object') {
        throw new BadRequestException(`windows[${i}]: must be an object`);
      }
      if (typeof w.start !== 'string' || !ISO_DATE.test(w.start)) {
        throw new BadRequestException(`windows[${i}].start must be ISO YYYY-MM-DD`);
      }
      if (typeof w.end !== 'string' || !ISO_DATE.test(w.end)) {
        throw new BadRequestException(`windows[${i}].end must be ISO YYYY-MM-DD`);
      }
      if (w.start > w.end) {
        throw new BadRequestException(
          `windows[${i}]: start ${w.start} is after end ${w.end}`,
        );
      }
      if (typeof w.label !== 'string' || w.label.trim() === '') {
        throw new BadRequestException(`windows[${i}].label must be a non-empty string`);
      }
      validated.push({ start: w.start, end: w.end, label: w.label.trim() });
    }

    const schedule = await this.presence.addVacationWindows(userId, validated);
    const user = schedule.user;
    return {
      user_id: userId,
      display_name: user?.displayName ?? '',
      is_admin: user?.isAdmin ?? false,
      is_restrictable: user?.isRestrictable ?? false,
      recurring_rule_kind: schedule.recurringRuleKind,
      grid_n_weeks: schedule.gridNWeeks,
      epoch_date: schedule.epochDate,
      grid_cells: (schedule.gridCells as GridCells | null) ?? null,
      one_off_windows: schedule.oneOffWindows ?? [],
    };
  }
}

function validateGridCells(raw: unknown, n: number): GridCells {
  if (!Array.isArray(raw) || raw.length !== n) {
    throw new BadRequestException(`grid_cells must be an array of ${n} weeks`);
  }
  const out: GridCells = [];
  for (let w = 0; w < n; w++) {
    const week = raw[w];
    if (!Array.isArray(week) || week.length !== 7) {
      throw new BadRequestException(
        `grid_cells[${w}] must be an array of 7 cells (Mon..Sun)`,
      );
    }
    const validatedWeek: GridCells[number] = [];
    for (let d = 0; d < 7; d++) {
      const cell = week[d] as { kind?: unknown; handoff_time?: unknown };
      if (!cell || (cell.kind !== 'home' && cell.kind !== 'away')) {
        throw new BadRequestException(
          `grid_cells[${w}][${d}].kind must be 'home' or 'away'`,
        );
      }
      const validated: GridCells[number][number] = { kind: cell.kind };
      if (cell.handoff_time != null && cell.handoff_time !== '') {
        if (typeof cell.handoff_time !== 'string' || !HHMM.test(cell.handoff_time)) {
          throw new BadRequestException(
            `grid_cells[${w}][${d}].handoff_time must be HH:MM`,
          );
        }
        validated.handoff_time = cell.handoff_time;
      }
      validatedWeek.push(validated);
    }
    out.push(validatedWeek);
  }
  return out;
}
