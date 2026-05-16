import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { DevicesService } from '../users/devices.service';
import { TasksService } from '../tasks/tasks.service';
import { OccurrencesService } from '../tasks/occurrences.service';
import { GoalsService } from '../goals/goals.service';
import { TransactionsService } from '../transactions/transactions.service';
import { Ladder } from '../tasks/resolution';
import { CLOCK, Clock } from '../clock/clock';
import { Inject } from '@nestjs/common';

export interface FactoryTrackeeInput {
  display_name?: string;
  is_admin?: boolean;
  is_restrictable?: boolean;
  username?: string;
  password?: string;
  color?: string;
  device?: {
    display_name?: string;
    ip_address?: string | null;
    mac_address?: string | null;
  };
}

export interface FactoryTaskInput {
  name?: string;
  kind?: 'reminder' | 'recurring';
  due_time?: string;
  points?: number;
  ladder?: Ladder;
  requires_verification?: boolean;
  allow_late_completion?: boolean;
  late_window_minutes?: number;
  active?: boolean;
  assignee_ids: string[];
  generate_for_today?: boolean;
}

export interface FactoryGoalInput {
  name?: string;
  category_id: string;
  kind?: 'flat' | 'tiered';
  points?: number;
  tier_values?: number[];
  completion_limit?: number;
  limit_window?: 'day' | 'week' | 'month' | 'lifetime';
  show_in_catalog?: boolean;
  usable_as_remediation?: boolean;
  assigned_to_user_id?: string | null;
}

export interface FactoryAdjustInput {
  user_id: string;
  amount: number;
  reason?: string;
}

/**
 * Thin façade over the production services. Tests use these to spin up
 * exactly the entities they need without re-encoding every required field.
 */
@Injectable()
export class E2eFactoryService {
  constructor(
    private readonly users: UsersService,
    private readonly devices: DevicesService,
    private readonly tasks: TasksService,
    private readonly occurrences: OccurrencesService,
    private readonly goals: GoalsService,
    private readonly txns: TransactionsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async createTrackee(input: FactoryTrackeeInput): Promise<{
    id: string;
    display_name: string;
    device_id: string | null;
  }> {
    const user = await this.users.createUser({
      displayName: input.display_name ?? 'Trackee',
      isAdmin: input.is_admin ?? false,
      isRestrictable: input.is_restrictable ?? true,
      username: input.username,
      password: input.password,
      color: input.color ?? '#FFB300',
    });
    let deviceId: string | null = null;
    if (input.device !== undefined) {
      const dev = await this.devices.create(user.id, {
        displayName: input.device.display_name ?? `${user.displayName}'s device`,
        ipAddress: input.device.ip_address ?? '10.0.0.99',
        macAddress: input.device.mac_address ?? 'aa:bb:cc:dd:ee:99',
      });
      deviceId = dev.id;
    }
    return { id: user.id, display_name: user.displayName, device_id: deviceId };
  }

  async createTask(
    input: FactoryTaskInput,
  ): Promise<{ id: string; due_time: string }> {
    const kind = input.kind ?? 'recurring';
    const task =
      kind === 'reminder'
        ? await this.tasks.createReminder({
            name: input.name ?? 'Test Task',
            icon: null,
            dueTime: input.due_time ?? '08:00',
            recurrence: { preset: 'daily' },
            active: input.active ?? true,
            assigneeIds: input.assignee_ids,
          })
        : await this.tasks.createRecurring({
            name: input.name ?? 'Test Task',
            icon: null,
            dueTime: input.due_time ?? '08:00',
            recurrence: { preset: 'daily' },
            points: input.points ?? 5,
            ladder: input.ladder,
            active: input.active ?? true,
            requiresVerification: input.requires_verification ?? false,
            allowLateCompletion: input.allow_late_completion ?? true,
            lateWindowMinutes: input.late_window_minutes ?? 720,
            assigneeIds: input.assignee_ids,
          });
    if (input.generate_for_today !== false) {
      await this.occurrences.generateForDate(this.clock.now());
    }
    return { id: task.id, due_time: task.dueTime };
  }

  async createGoal(
    input: FactoryGoalInput,
  ): Promise<{ id: string; name: string }> {
    const goal = await this.goals.create({
      name: input.name ?? 'Test Goal',
      icon: null,
      note: null,
      categoryId: input.category_id,
      kind: input.kind ?? 'flat',
      points: input.points ?? 10,
      tierValues: input.tier_values,
      completionLimit: input.completion_limit ?? 5,
      limitWindow: input.limit_window ?? 'week',
      showInCatalog: input.show_in_catalog ?? true,
      usableAsRemediation: input.usable_as_remediation ?? false,
      assignedToUserId: input.assigned_to_user_id ?? null,
      active: true,
    });
    return { id: goal.id, name: goal.name };
  }

  async adjustBalance(input: FactoryAdjustInput): Promise<void> {
    await this.txns.append({
      userId: input.user_id,
      kind: 'adjustment',
      amount: input.amount,
      reason: input.reason ?? 'e2e seed',
    });
  }
}
