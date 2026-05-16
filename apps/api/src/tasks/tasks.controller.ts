import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CLOCK, Clock } from '../clock/clock';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { TasksService } from './tasks.service';
import { OccurrencesService } from './occurrences.service';
import { RealtimeBus } from '../realtime/realtime-bus';
import {
  CreateRecurringTaskDto,
  CreateReminderTaskDto,
  CreateWindowedTaskDto,
  UpdateRecurringTaskDto,
  UpdateReminderTaskDto,
  UpdateWindowedTaskDto,
} from './dto';
import { TaskEntity, TaskKind } from './task.entity';
import { RecurrencePattern } from './recurrence';
import { Ladder } from './resolution';

interface TaskView {
  id: string;
  kind: TaskKind;
  name: string;
  icon: string | null;
  due_time: string;
  recurrence: RecurrencePattern | null;
  points: number;
  ladder: Ladder;
  ladder_reset_threshold: number;
  active: boolean;
  requires_verification: boolean;
  allow_late_completion: boolean;
  late_window_minutes: number;
  // Windowed-task knobs. Recurring windowed tasks carry the offsets;
  // one-shot windowed tasks carry neither (their window lives on the
  // single materialized occurrence).
  window_start_offset_minutes: number | null;
  window_end_offset_minutes: number | null;
  created_at: string;
  assignee_ids: string[];
}

function toView(task: TaskEntity): TaskView {
  return {
    id: task.id,
    kind: task.kind,
    name: task.name,
    icon: task.icon,
    // Trim Postgres TIME's ':SS' tail back to 'HH:MM' for the wire.
    due_time: task.dueTime.slice(0, 5),
    recurrence: task.recurrence ?? null,
    points: task.points ?? 0,
    ladder: task.ladder ?? [{ points: 1, restriction: null }],
    ladder_reset_threshold: task.ladderResetThreshold ?? 3,
    active: task.active,
    requires_verification: task.requiresVerification ?? false,
    allow_late_completion: task.allowLateCompletion ?? true,
    late_window_minutes: task.lateWindowMinutes ?? 720,
    window_start_offset_minutes: task.windowStartOffsetMinutes ?? null,
    window_end_offset_minutes: task.windowEndOffsetMinutes ?? null,
    created_at: task.createdAt.toISOString(),
    assignee_ids: (task.assignees ?? []).map((u) => u.id),
  };
}

@Controller('tasks')
@UseGuards(JwtAuthGuard, AdminGuard)
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly occurrences: OccurrencesService,
    private readonly bus: RealtimeBus,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  async list(@Query('kind') kind?: string): Promise<{ tasks: TaskView[] }> {
    const filter: TaskKind | undefined =
      kind === 'reminder'
        ? 'reminder'
        : kind === 'recurring'
          ? 'recurring'
          : kind === 'windowed'
            ? 'windowed'
            : undefined;
    const tasks = await this.tasks.list(filter);
    return { tasks: tasks.map(toView) };
  }

  @Post()
  async create(@Body() dto: CreateReminderTaskDto): Promise<TaskView> {
    if (dto.recurrence !== undefined && dto.recurrence !== null) {
      assertRecurrence(dto.recurrence);
    }
    const task = await this.tasks.createReminder({
      name: dto.name,
      icon: dto.icon ?? null,
      dueTime: dto.due_time,
      recurrence: dto.recurrence ?? null,
      active: dto.active ?? true,
      assigneeIds: dto.assignee_ids,
    });
    // Materialize today's occurrences for the new task immediately, so the
    // tablet picks it up without waiting for the next day-rollover sweep.
    await this.occurrences.generateForDate(this.clock.now());
    this.bus.emit({ kind: 'tasks:changed' });
    return toView(task);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReminderTaskDto,
  ): Promise<TaskView> {
    if (dto.recurrence !== undefined && dto.recurrence !== null) {
      assertRecurrence(dto.recurrence);
    }
    const task = await this.tasks.update(id, {
      name: dto.name,
      icon: dto.icon,
      dueTime: dto.due_time,
      recurrence: dto.recurrence,
      active: dto.active,
      assigneeIds: dto.assignee_ids,
    });
    await this.occurrences.generateForDate(this.clock.now());
    this.bus.emit({ kind: 'tasks:changed' });
    return toView(task);
  }

  @Post('recurring')
  async createRecurring(@Body() dto: CreateRecurringTaskDto): Promise<TaskView> {
    assertRecurrence(dto.recurrence);
    const task = await this.tasks.createRecurring({
      name: dto.name,
      icon: dto.icon ?? null,
      dueTime: dto.due_time,
      recurrence: dto.recurrence,
      points: dto.points,
      ladder: dto.ladder ? normalizeLadder(dto.ladder) : undefined,
      ladderResetThreshold: dto.ladder_reset_threshold,
      active: dto.active ?? true,
      requiresVerification: dto.requires_verification ?? false,
      allowLateCompletion: dto.allow_late_completion ?? true,
      lateWindowMinutes: dto.late_window_minutes,
      assigneeIds: dto.assignee_ids,
    });
    await this.occurrences.generateForDate(this.clock.now());
    this.bus.emit({ kind: 'tasks:changed' });
    return toView(task);
  }

  @Patch('recurring/:id')
  async updateRecurring(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecurringTaskDto,
  ): Promise<TaskView> {
    if (dto.recurrence !== undefined) assertRecurrence(dto.recurrence);
    const task = await this.tasks.updateRecurring(id, {
      name: dto.name,
      icon: dto.icon,
      dueTime: dto.due_time,
      recurrence: dto.recurrence,
      points: dto.points,
      ladder: dto.ladder ? normalizeLadder(dto.ladder) : undefined,
      ladderResetThreshold: dto.ladder_reset_threshold,
      active: dto.active,
      requiresVerification: dto.requires_verification,
      allowLateCompletion: dto.allow_late_completion,
      lateWindowMinutes: dto.late_window_minutes,
      assigneeIds: dto.assignee_ids,
    });
    await this.occurrences.generateForDate(this.clock.now());
    this.bus.emit({ kind: 'tasks:changed' });
    return toView(task);
  }

  @Post('windowed')
  async createWindowed(@Body() dto: CreateWindowedTaskDto): Promise<TaskView> {
    if (dto.recurrence !== undefined && dto.recurrence !== null) {
      assertRecurrence(dto.recurrence);
    }
    const task = await this.tasks.createWindowed({
      name: dto.name,
      icon: dto.icon ?? null,
      recurrence: dto.recurrence ?? null,
      windowStartOffsetMinutes: dto.window_start_offset_minutes ?? null,
      windowEndOffsetMinutes: dto.window_end_offset_minutes ?? null,
      windowStart: dto.window_start ?? null,
      windowEnd: dto.window_end ?? null,
      points: dto.points,
      ladder: dto.ladder ? normalizeLadder(dto.ladder) : undefined,
      ladderResetThreshold: dto.ladder_reset_threshold,
      active: dto.active ?? true,
      requiresVerification: dto.requires_verification ?? false,
      assigneeIds: dto.assignee_ids,
    });
    // One-shot windowed tasks materialize their single occurrence now so
    // they appear on the tablet without waiting for the daily sweep.
    if (
      (dto.recurrence === undefined || dto.recurrence === null) &&
      dto.window_start &&
      dto.window_end
    ) {
      // Reload to pick up the persisted assignees relation.
      const fresh = await this.tasks.findById(task.id);
      await this.occurrences.createOneShotWindowedOccurrence(
        fresh,
        new Date(dto.window_start),
        new Date(dto.window_end),
      );
    }
    await this.occurrences.generateForDate(this.clock.now());
    this.bus.emit({ kind: 'tasks:changed' });
    return toView(task);
  }

  @Patch('windowed/:id')
  async updateWindowed(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWindowedTaskDto,
  ): Promise<TaskView> {
    if (dto.recurrence !== undefined && dto.recurrence !== null) {
      assertRecurrence(dto.recurrence);
    }
    const task = await this.tasks.updateWindowed(id, {
      name: dto.name,
      icon: dto.icon,
      recurrence: dto.recurrence,
      windowStartOffsetMinutes: dto.window_start_offset_minutes,
      windowEndOffsetMinutes: dto.window_end_offset_minutes,
      points: dto.points,
      ladder: dto.ladder ? normalizeLadder(dto.ladder) : undefined,
      ladderResetThreshold: dto.ladder_reset_threshold,
      active: dto.active,
      requiresVerification: dto.requires_verification,
      assigneeIds: dto.assignee_ids,
    });
    await this.occurrences.generateForDate(this.clock.now());
    this.bus.emit({ kind: 'tasks:changed' });
    return toView(task);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.tasks.remove(id);
    this.bus.emit({ kind: 'tasks:changed' });
  }
}

const VALID_PRESETS = new Set([
  'daily',
  'weekdays',
  'weekends',
  'weekly',
  'biweekly',
  'every_n_days',
  'every_n_weeks',
  'every_n_months',
  'yearly_on_date',
  'yearly_in_month',
]);

function normalizeLadder(
  tiers: Array<{
    points: number;
    restriction?: {
      type: 'internet' | 'entertainment' | 'games';
      duration_minutes?: number | null;
      remediation_goal_ids?: string[] | null;
    } | null;
  }>,
): Ladder {
  return tiers.map((t) => ({
    points: t.points,
    restriction: t.restriction
      ? {
          type: t.restriction.type,
          duration_minutes: t.restriction.duration_minutes ?? null,
          remediation_goal_ids: t.restriction.remediation_goal_ids ?? null,
        }
      : null,
  }));
}

function assertRecurrence(value: unknown): asserts value is RecurrencePattern {
  if (!value || typeof value !== 'object') {
    throw new BadRequestException('recurrence must be an object');
  }
  const preset = (value as { preset?: unknown }).preset;
  if (typeof preset !== 'string' || !VALID_PRESETS.has(preset)) {
    throw new BadRequestException(`unknown recurrence preset: ${String(preset)}`);
  }
}
