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
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { OccurrenceEntity } from './occurrence.entity';
import { OccurrenceActionsService } from './occurrence-actions.service';

interface AdminOccurrenceView {
  id: string;
  task_id: string;
  task_name: string;
  task_icon: string | null;
  task_points: number;
  user_id: string;
  scheduled_at: string;
  status: OccurrenceEntity['status'];
  deferred_from_occurrence_id: string | null;
}

interface DeferBody {
  date: string;
}

@Controller('admin/occurrences')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminOccurrencesController {
  constructor(
    @InjectRepository(OccurrenceEntity)
    private readonly occurrences: Repository<OccurrenceEntity>,
    private readonly actions: OccurrenceActionsService,
  ) {}

  /**
   * Per-Trackee occurrence history (inclusive of past missed/excused/deferred).
   * Defaults to the trailing 30 days; callers may narrow via `from`/`to` ISO
   * dates. The admin UI uses this to surface Excuse/Defer affordances on past
   * rows.
   */
  @Get('trackee/:userId')
  async forTrackee(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
  ): Promise<{ occurrences: AdminOccurrenceView[] }> {
    const to = parseLocalDate(toStr) ?? new Date();
    const from = parseLocalDate(fromStr) ?? new Date(to.getTime() - 30 * 86400_000);
    const fromStart = startOfDay(from);
    const toEnd = endOfDay(to);
    const rows = await this.occurrences.find({
      where: { userId, scheduledAt: Between(fromStart, toEnd) },
      relations: { task: true },
      order: { scheduledAt: 'DESC' },
    });
    return {
      occurrences: rows
        .filter((r) => r.task)
        .map((r) => ({
          id: r.id,
          task_id: r.taskId,
          task_name: r.task.name,
          task_icon: r.task.icon,
          task_points: r.task.points ?? 0,
          user_id: r.userId,
          scheduled_at: r.scheduledAt.toISOString(),
          status: r.status,
          deferred_from_occurrence_id: r.deferredFromOccurrenceId ?? null,
        })),
    };
  }

  @Post(':id/excuse')
  async excuse(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ id: string; status: 'excused' }> {
    const adminUserId = adminIdOf(req);
    const occ = await this.actions.excuse(id, adminUserId);
    return { id: occ.id, status: 'excused' };
  }

  @Post(':id/defer')
  async defer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DeferBody,
    @Req() req: AuthenticatedRequest,
  ): Promise<{
    id: string;
    status: 'deferred';
    deferred_occurrence_id: string;
  }> {
    if (!body || typeof body.date !== 'string') {
      throw new BadRequestException('body.date is required (YYYY-MM-DD)');
    }
    const date = parseLocalDate(body.date);
    if (!date) {
      throw new BadRequestException('body.date must be YYYY-MM-DD');
    }
    const adminUserId = adminIdOf(req);
    const { original, deferred } = await this.actions.defer(id, date, adminUserId);
    return {
      id: original.id,
      status: 'deferred',
      deferred_occurrence_id: deferred.id,
    };
  }
}

function adminIdOf(req: AuthenticatedRequest): string {
  const s = req.session;
  if (!s || s.kind !== 'admin') return '';
  return s.sub;
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

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}
