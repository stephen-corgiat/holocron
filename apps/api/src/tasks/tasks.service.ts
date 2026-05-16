import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { TaskEntity, TaskKind } from './task.entity';
import { UserEntity } from '../users/user.entity';
import { RecurrencePattern } from './recurrence';
import { Ladder } from './resolution';

const DEFAULT_LADDER: Ladder = [{ points: 1, restriction: null }];
const DEFAULT_LADDER_RESET_THRESHOLD = 3;

export interface CreateReminderTaskInput {
  name: string;
  icon?: string | null;
  dueTime: string; // 'HH:MM'
  recurrence?: RecurrencePattern | null;
  active?: boolean;
  assigneeIds: string[];
}

export interface UpdateReminderTaskInput {
  name?: string;
  icon?: string | null;
  dueTime?: string;
  recurrence?: RecurrencePattern | null;
  active?: boolean;
  assigneeIds?: string[];
}

export interface CreateRecurringTaskInput {
  name: string;
  icon?: string | null;
  dueTime: string;
  recurrence: RecurrencePattern;
  points: number;
  ladder?: Ladder;
  ladderResetThreshold?: number;
  active?: boolean;
  requiresVerification?: boolean;
  allowLateCompletion?: boolean;
  lateWindowMinutes?: number;
  assigneeIds: string[];
}

export interface UpdateRecurringTaskInput {
  name?: string;
  icon?: string | null;
  dueTime?: string;
  recurrence?: RecurrencePattern;
  points?: number;
  ladder?: Ladder;
  ladderResetThreshold?: number;
  active?: boolean;
  requiresVerification?: boolean;
  allowLateCompletion?: boolean;
  lateWindowMinutes?: number;
  assigneeIds?: string[];
}

export interface CreateWindowedTaskInput {
  name: string;
  icon?: string | null;
  // Recurring case: omit window_start/window_end, supply recurrence + offsets.
  recurrence?: RecurrencePattern | null;
  windowStartOffsetMinutes?: number | null;
  windowEndOffsetMinutes?: number | null;
  // One-shot case: ISO timestamps. The service materializes one occurrence
  // immediately (in OccurrencesService) using these absolute bounds.
  windowStart?: string | null;
  windowEnd?: string | null;
  points: number;
  ladder?: Ladder;
  ladderResetThreshold?: number;
  active?: boolean;
  requiresVerification?: boolean;
  assigneeIds: string[];
}

export interface UpdateWindowedTaskInput {
  name?: string;
  icon?: string | null;
  recurrence?: RecurrencePattern | null;
  windowStartOffsetMinutes?: number | null;
  windowEndOffsetMinutes?: number | null;
  points?: number;
  ladder?: Ladder;
  ladderResetThreshold?: number;
  active?: boolean;
  requiresVerification?: boolean;
  assigneeIds?: string[];
}

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(TaskEntity)
    private readonly tasks: Repository<TaskEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
  ) {}

  list(kind?: TaskKind): Promise<TaskEntity[]> {
    return this.tasks.find({
      where: kind ? { kind } : {},
      relations: { assignees: true },
      order: { createdAt: 'ASC' },
    });
  }

  async findById(id: string): Promise<TaskEntity> {
    const task = await this.tasks.findOne({
      where: { id },
      relations: { assignees: true },
    });
    if (!task) throw new NotFoundException(`task ${id} not found`);
    return task;
  }

  /** Active reminder tasks with active assignees — drives reminder occurrence generation. */
  async activeReminderTasks(): Promise<TaskEntity[]> {
    return this.tasks.find({
      where: { kind: 'reminder', active: true },
      relations: { assignees: true },
    });
  }

  /** Active recurring tasks with active assignees — drives recurring occurrence generation. */
  async activeRecurringTasks(): Promise<TaskEntity[]> {
    return this.tasks.find({
      where: { kind: 'recurring', active: true },
      relations: { assignees: true },
    });
  }

  /**
   * Active recurring-flavored windowed tasks (those with a `recurrence`).
   * One-shot windowed tasks materialize their single occurrence at creation,
   * so the daily generation sweep skips them.
   */
  async activeRecurringWindowedTasks(): Promise<TaskEntity[]> {
    const all = await this.tasks.find({
      where: { kind: 'windowed', active: true },
      relations: { assignees: true },
    });
    return all.filter((t) => t.recurrence !== null);
  }

  async createReminder(input: CreateReminderTaskInput): Promise<TaskEntity> {
    const assignees = await this.resolveAssignees(input.assigneeIds);
    const entity = this.tasks.create({
      kind: 'reminder',
      name: input.name,
      icon: input.icon ?? null,
      dueTime: normalizeDueTime(input.dueTime),
      active: input.active ?? true,
      points: 0,
      recurrence: input.recurrence ?? null,
      assignees,
    });
    return this.tasks.save(entity);
  }

  async update(id: string, patch: UpdateReminderTaskInput): Promise<TaskEntity> {
    const task = await this.findById(id);
    if (patch.name !== undefined) task.name = patch.name;
    if (patch.icon !== undefined) task.icon = patch.icon;
    if (patch.dueTime !== undefined) task.dueTime = normalizeDueTime(patch.dueTime);
    if (patch.recurrence !== undefined) task.recurrence = patch.recurrence;
    if (patch.active !== undefined) task.active = patch.active;
    if (patch.assigneeIds !== undefined) {
      task.assignees = await this.resolveAssignees(patch.assigneeIds);
    }
    return this.tasks.save(task);
  }

  async createRecurring(input: CreateRecurringTaskInput): Promise<TaskEntity> {
    const assignees = await this.resolveAssignees(input.assigneeIds);
    const entity = this.tasks.create({
      kind: 'recurring',
      name: input.name,
      icon: input.icon ?? null,
      dueTime: normalizeDueTime(input.dueTime),
      recurrence: input.recurrence,
      points: input.points,
      ladder: input.ladder && input.ladder.length > 0 ? input.ladder : DEFAULT_LADDER,
      ladderResetThreshold:
        input.ladderResetThreshold ?? DEFAULT_LADDER_RESET_THRESHOLD,
      active: input.active ?? true,
      requiresVerification: input.requiresVerification ?? false,
      allowLateCompletion: input.allowLateCompletion ?? true,
      lateWindowMinutes: input.lateWindowMinutes ?? 720,
      assignees,
    });
    return this.tasks.save(entity);
  }

  async updateRecurring(
    id: string,
    patch: UpdateRecurringTaskInput,
  ): Promise<TaskEntity> {
    const task = await this.findById(id);
    if (task.kind !== 'recurring') {
      throw new BadRequestException(`task ${id} is not a recurring task`);
    }
    if (patch.name !== undefined) task.name = patch.name;
    if (patch.icon !== undefined) task.icon = patch.icon;
    if (patch.dueTime !== undefined) task.dueTime = normalizeDueTime(patch.dueTime);
    if (patch.recurrence !== undefined) task.recurrence = patch.recurrence;
    if (patch.points !== undefined) task.points = patch.points;
    if (patch.ladder !== undefined && patch.ladder.length > 0) {
      task.ladder = patch.ladder;
    }
    if (patch.ladderResetThreshold !== undefined) {
      task.ladderResetThreshold = patch.ladderResetThreshold;
    }
    if (patch.active !== undefined) task.active = patch.active;
    if (patch.requiresVerification !== undefined) {
      task.requiresVerification = patch.requiresVerification;
    }
    if (patch.allowLateCompletion !== undefined) {
      task.allowLateCompletion = patch.allowLateCompletion;
    }
    if (patch.lateWindowMinutes !== undefined) {
      task.lateWindowMinutes = patch.lateWindowMinutes;
    }
    if (patch.assigneeIds !== undefined) {
      task.assignees = await this.resolveAssignees(patch.assigneeIds);
    }
    return this.tasks.save(task);
  }

  async createWindowed(input: CreateWindowedTaskInput): Promise<TaskEntity> {
    const assignees = await this.resolveAssignees(input.assigneeIds);
    const isRecurring = input.recurrence != null;
    if (isRecurring) {
      if (
        input.windowStartOffsetMinutes == null ||
        input.windowEndOffsetMinutes == null
      ) {
        throw new BadRequestException(
          'recurring windowed tasks require window_start_offset_minutes and window_end_offset_minutes',
        );
      }
      if (input.windowEndOffsetMinutes <= input.windowStartOffsetMinutes) {
        throw new BadRequestException(
          'window_end_offset_minutes must be greater than window_start_offset_minutes',
        );
      }
    } else {
      if (!input.windowStart || !input.windowEnd) {
        throw new BadRequestException(
          'one-shot windowed tasks require window_start and window_end',
        );
      }
      if (new Date(input.windowEnd) <= new Date(input.windowStart)) {
        throw new BadRequestException('window_end must be after window_start');
      }
    }
    const entity = this.tasks.create({
      kind: 'windowed',
      name: input.name,
      icon: input.icon ?? null,
      // Windowed tasks ignore due_time at the day level (offsets carry the
      // time-of-day); store '00:00:00' for column-NOT-NULL compliance.
      dueTime: '00:00:00',
      recurrence: input.recurrence ?? null,
      windowStartOffsetMinutes: input.windowStartOffsetMinutes ?? null,
      windowEndOffsetMinutes: input.windowEndOffsetMinutes ?? null,
      points: input.points,
      ladder:
        input.ladder && input.ladder.length > 0 ? input.ladder : DEFAULT_LADDER,
      ladderResetThreshold:
        input.ladderResetThreshold ?? DEFAULT_LADDER_RESET_THRESHOLD,
      active: input.active ?? true,
      requiresVerification: input.requiresVerification ?? false,
      // The window already provided the flex — Late completion is disabled.
      allowLateCompletion: false,
      lateWindowMinutes: 0,
      assignees,
    });
    return this.tasks.save(entity);
  }

  async updateWindowed(
    id: string,
    patch: UpdateWindowedTaskInput,
  ): Promise<TaskEntity> {
    const task = await this.findById(id);
    if (task.kind !== 'windowed') {
      throw new BadRequestException(`task ${id} is not a windowed task`);
    }
    if (patch.name !== undefined) task.name = patch.name;
    if (patch.icon !== undefined) task.icon = patch.icon;
    if (patch.recurrence !== undefined) task.recurrence = patch.recurrence;
    if (patch.windowStartOffsetMinutes !== undefined) {
      task.windowStartOffsetMinutes = patch.windowStartOffsetMinutes;
    }
    if (patch.windowEndOffsetMinutes !== undefined) {
      task.windowEndOffsetMinutes = patch.windowEndOffsetMinutes;
    }
    if (
      task.recurrence != null &&
      task.windowStartOffsetMinutes != null &&
      task.windowEndOffsetMinutes != null &&
      task.windowEndOffsetMinutes <= task.windowStartOffsetMinutes
    ) {
      throw new BadRequestException(
        'window_end_offset_minutes must be greater than window_start_offset_minutes',
      );
    }
    if (patch.points !== undefined) task.points = patch.points;
    if (patch.ladder !== undefined && patch.ladder.length > 0) {
      task.ladder = patch.ladder;
    }
    if (patch.ladderResetThreshold !== undefined) {
      task.ladderResetThreshold = patch.ladderResetThreshold;
    }
    if (patch.active !== undefined) task.active = patch.active;
    if (patch.requiresVerification !== undefined) {
      task.requiresVerification = patch.requiresVerification;
    }
    if (patch.assigneeIds !== undefined) {
      task.assignees = await this.resolveAssignees(patch.assigneeIds);
    }
    // Always force-disabled on windowed tasks.
    task.allowLateCompletion = false;
    task.lateWindowMinutes = 0;
    return this.tasks.save(task);
  }

  async remove(id: string): Promise<void> {
    const task = await this.findById(id);
    await this.tasks.remove(task);
  }

  private async resolveAssignees(ids: string[]): Promise<UserEntity[]> {
    if (ids.length === 0) return [];
    const found = await this.users.find({
      where: { id: In(ids), deactivatedAt: IsNull() },
    });
    if (found.length !== ids.length) {
      throw new BadRequestException(
        'one or more assignee_ids reference unknown or deactivated Trackees',
      );
    }
    return found;
  }
}

/** Postgres TIME round-trips as 'HH:MM:SS'; normalize so input + reads match. */
function normalizeDueTime(value: string): string {
  if (/^\d{2}:\d{2}$/.test(value)) return `${value}:00`;
  return value;
}
