/**
 * Seed the database with a starter household: users, presence schedules,
 * devices, goal categories, goals, and recurring tasks. Data lives in JSON
 * files under ./seed-data/ — edit those, not this script.
 *
 * Behavior is upsert-by-name (display_name for users, name for categories /
 * goals / tasks): re-running won't create duplicates, and will refresh fields
 * that have changed. Existing point balances, completions, and occurrences
 * are not touched.
 *
 * Usage:
 *   npm run seed                       # from the repo root
 *   npm --workspace apps/api run seed
 *
 * Requires the database to be migrated first (`npm run migration:run`).
 */

import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as bcrypt from 'bcryptjs';
import { DataSource, IsNull, Repository } from 'typeorm';
import { dataSourceOptions } from '../database/data-source';

import { UserEntity } from '../users/user.entity';
import { DeviceEntity } from '../users/device.entity';
import { slugifyDisplayName } from '../users/slug';
import {
  PresenceScheduleEntity,
  RecurringRuleKind,
} from '../presence/presence.entity';
import type { GridCell, GridCells } from '../presence/presence-resolver';
import { CategoryEntity } from '../goals/category.entity';
import { GoalEntity, GoalKind, LimitWindow } from '../goals/goal.entity';
import { TaskEntity, TaskKind } from '../tasks/task.entity';
import type { Ladder, RestrictionSpec } from '../tasks/resolution';
import type { RecurrencePattern } from '../tasks/recurrence';

const BCRYPT_COST = 10;
const SEED_DIR = resolve(__dirname, 'seed-data');

// ---- JSON shapes ----------------------------------------------------------

interface SeedUser {
  displayName: string;
  username?: string;
  password?: string;
  isAdmin: boolean;
  isRestrictable: boolean;
  color?: string | null;
  avatar?: string | null;
  presence: PresenceSpec;
  devices?: SeedDevice[];
}

type PresenceSpec =
  | { kind: 'none' | 'full_time' }
  | {
      kind: 'n_week_grid';
      nWeeks: number;
      epochDate: string;
      cells: GridCell[][];
    };

interface SeedDevice {
  displayName: string;
  ipAddress: string | null;
  macAddress: string | null;
}

interface SeedCategory {
  name: string;
  sortOrder?: number;
}

type Audience = 'child' | 'adult' | 'all';

interface SeedGoal {
  name: string;
  audience: Audience;
  category: string;
  kind: GoalKind;
  points?: number;
  tierValues?: number[];
  completionLimit: number;
  limitWindow: LimitWindow;
  usableAsRemediation?: boolean;
  showInCatalog?: boolean;
  note?: string | null;
  icon?: string | null;
}

interface SeedTaskFile {
  kidLadderModerate: Ladder;
  kidLadderLight: Ladder;
  adultLadderLight: Ladder;
  tasks: SeedTask[];
}

type LadderKey = Exclude<keyof SeedTaskFile, 'tasks'>;

interface SeedTask {
  name: string;
  kind: TaskKind;
  dueTime: string;
  recurrence: RecurrencePattern;
  points: number;
  ladderRef: LadderKey;
  ladderResetThreshold?: number;
  requiresVerification?: boolean;
  allowLateCompletion?: boolean;
  lateWindowMinutes?: number;
  assignees: string[];
}

// ---- IO -------------------------------------------------------------------

function loadJson<T>(filename: string): T {
  const path = resolve(SEED_DIR, filename);
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as T;
}

// ---- Seeders --------------------------------------------------------------

async function seedUsers(ds: DataSource): Promise<Map<string, UserEntity>> {
  const file = loadJson<{ users: SeedUser[] }>('users.json');
  const users = ds.getRepository(UserEntity);
  const schedules = ds.getRepository(PresenceScheduleEntity);
  const devices = ds.getRepository(DeviceEntity);

  const byName = new Map<string, UserEntity>();

  for (const u of file.users) {
    if (u.isAdmin && !u.password) {
      throw new Error(
        `Seed user "${u.displayName}" is admin but has no password.`,
      );
    }
    const username =
      u.username?.toLowerCase().trim() ||
      (u.isAdmin ? slugifyDisplayName(u.displayName) : null);

    let existing = await users.findOne({ where: { displayName: u.displayName } });
    if (!existing) {
      existing = users.create({
        username,
        displayName: u.displayName,
        passwordHash: u.password ? await bcrypt.hash(u.password, BCRYPT_COST) : null,
        isAdmin: u.isAdmin,
        isRestrictable: u.isRestrictable,
        routerId: slugifyDisplayName(u.displayName),
        avatar: u.avatar ?? null,
        color: u.color ?? null,
        deactivatedAt: null,
      });
      existing = await users.save(existing);
      console.log(`  + user ${u.displayName} (${u.isAdmin ? 'admin' : 'trackee'})`);
    } else {
      existing.username = username;
      existing.isAdmin = u.isAdmin;
      existing.isRestrictable = u.isRestrictable;
      existing.routerId = existing.routerId ?? slugifyDisplayName(u.displayName);
      existing.avatar = u.avatar ?? null;
      existing.color = u.color ?? null;
      existing.deactivatedAt = null;
      if (u.password) {
        existing.passwordHash = await bcrypt.hash(u.password, BCRYPT_COST);
      }
      existing = await users.save(existing);
      console.log(`  ~ user ${u.displayName} (refreshed)`);
    }
    byName.set(u.displayName, existing);

    await upsertPresence(schedules, existing.id, u.presence);
    if (u.devices && u.devices.length > 0) {
      await upsertDevices(devices, existing.id, u.devices);
    }
  }

  return byName;
}

async function upsertPresence(
  repo: Repository<PresenceScheduleEntity>,
  userId: string,
  spec: PresenceSpec,
): Promise<void> {
  let row = await repo.findOne({ where: { userId } });
  if (!row) {
    row = repo.create({
      userId,
      recurringRuleKind: spec.kind as RecurringRuleKind,
      oneOffWindows: [],
    });
  }
  row.recurringRuleKind = spec.kind as RecurringRuleKind;
  if (spec.kind === 'n_week_grid') {
    row.gridNWeeks = spec.nWeeks;
    row.epochDate = spec.epochDate;
    row.gridCells = spec.cells as GridCells;
  } else {
    row.gridNWeeks = null;
    row.epochDate = null;
    row.gridCells = null;
  }
  await repo.save(row);
}

async function upsertDevices(
  repo: Repository<DeviceEntity>,
  userId: string,
  specs: SeedDevice[],
): Promise<void> {
  const existing = await repo.find({ where: { userId } });
  const byName = new Map(existing.map((d) => [d.displayName, d]));
  for (const spec of specs) {
    let row = byName.get(spec.displayName);
    if (!row) {
      row = repo.create({
        userId,
        displayName: spec.displayName,
        ipAddress: spec.ipAddress,
        macAddress: spec.macAddress,
      });
    } else {
      row.ipAddress = spec.ipAddress;
      row.macAddress = spec.macAddress;
    }
    await repo.save(row);
  }
}

async function seedCategories(
  ds: DataSource,
): Promise<Map<string, CategoryEntity>> {
  const file = loadJson<{ categories: SeedCategory[] }>('categories.json');
  const repo = ds.getRepository(CategoryEntity);
  const byName = new Map<string, CategoryEntity>();
  for (const c of file.categories) {
    let row = await repo.findOne({ where: { name: c.name } });
    if (!row) {
      row = repo.create({ name: c.name, sortOrder: c.sortOrder ?? 0 });
      row = await repo.save(row);
      console.log(`  + category ${c.name}`);
    } else if (row.sortOrder !== (c.sortOrder ?? 0)) {
      row.sortOrder = c.sortOrder ?? 0;
      row = await repo.save(row);
    }
    byName.set(c.name, row);
  }
  return byName;
}

async function seedGoals(
  ds: DataSource,
  users: Map<string, UserEntity>,
  categories: Map<string, CategoryEntity>,
): Promise<void> {
  const file = loadJson<{ goals: SeedGoal[] }>('goals.json');
  const repo = ds.getRepository(GoalEntity);

  const allUsers = Array.from(users.values());
  const childUsers = allUsers.filter((u) => !u.isAdmin);
  const adultUsers = allUsers.filter((u) => u.isAdmin);

  for (const g of file.goals) {
    const category = categories.get(g.category);
    if (!category) {
      throw new Error(`Goal "${g.name}" references unknown category "${g.category}".`);
    }

    // One row per matching Trackee for child/adult; one unassigned row for "all".
    const assignees: Array<UserEntity | null> =
      g.audience === 'all'
        ? [null]
        : g.audience === 'child'
          ? childUsers
          : adultUsers;

    for (const assignee of assignees) {
      const where = assignee
        ? { name: g.name, assignedToUserId: assignee.id }
        : { name: g.name, assignedToUserId: IsNull() };
      let row = await repo.findOne({ where });
      const fields = {
        name: g.name,
        icon: g.icon ?? null,
        note: g.note ?? null,
        categoryId: category.id,
        kind: g.kind,
        points: g.kind === 'tiered' ? 0 : g.points ?? 0,
        tierValues: g.kind === 'tiered' ? g.tierValues ?? [] : [],
        completionLimit: g.completionLimit,
        limitWindow: g.limitWindow,
        showInCatalog: g.showInCatalog ?? true,
        usableAsRemediation: g.usableAsRemediation ?? false,
        assignedToUserId: assignee?.id ?? null,
        active: true,
      };
      if (!row) {
        row = repo.create(fields);
        await repo.save(row);
        const tag = assignee ? `→ ${assignee.displayName}` : '(shared)';
        console.log(`  + goal ${g.name} ${tag}`);
      } else {
        Object.assign(row, fields);
        await repo.save(row);
      }
    }
  }
}

async function seedTasks(
  ds: DataSource,
  users: Map<string, UserEntity>,
): Promise<void> {
  const file = loadJson<SeedTaskFile>('routines.json');
  const repo = ds.getRepository(TaskEntity);
  const ladders: Record<LadderKey, Ladder> = {
    kidLadderModerate: normalizeLadder(file.kidLadderModerate),
    kidLadderLight: normalizeLadder(file.kidLadderLight),
    adultLadderLight: normalizeLadder(file.adultLadderLight),
  };

  for (const t of file.tasks) {
    if (t.kind !== 'recurring') {
      throw new Error(
        `Seed task "${t.name}" has kind="${t.kind}"; only "recurring" is supported by the seeder.`,
      );
    }
    const assignees = t.assignees.map((displayName) => {
      const u = users.get(displayName);
      if (!u) throw new Error(`Task "${t.name}" references unknown user "${displayName}".`);
      return u;
    });
    const ladder = ladders[t.ladderRef];
    if (!ladder) {
      throw new Error(`Task "${t.name}" references unknown ladder "${t.ladderRef}".`);
    }

    let row = await repo.findOne({
      where: { name: t.name, kind: 'recurring' },
      relations: { assignees: true },
    });
    const fields = {
      kind: 'recurring' as TaskKind,
      name: t.name,
      icon: null,
      dueTime: normalizeDueTime(t.dueTime),
      recurrence: t.recurrence,
      points: t.points,
      ladder,
      ladderResetThreshold: t.ladderResetThreshold ?? 3,
      active: true,
      requiresVerification: t.requiresVerification ?? false,
      allowLateCompletion: t.allowLateCompletion ?? true,
      lateWindowMinutes: t.lateWindowMinutes ?? 720,
      windowStartOffsetMinutes: null,
      windowEndOffsetMinutes: null,
    };
    if (!row) {
      row = repo.create({ ...fields, assignees });
      await repo.save(row);
      console.log(`  + task ${t.name} → ${assignees.map((a) => a.displayName).join(', ')}`);
    } else {
      Object.assign(row, fields);
      row.assignees = assignees;
      await repo.save(row);
    }
  }
}

function normalizeLadder(raw: Ladder): Ladder {
  return raw.map((tier) => ({
    points: tier.points,
    restriction: tier.restriction ? normalizeRestriction(tier.restriction) : null,
  }));
}

function normalizeRestriction(spec: RestrictionSpec): RestrictionSpec {
  return {
    type: spec.type,
    duration_minutes: spec.duration_minutes ?? null,
    remediation_goal_ids: spec.remediation_goal_ids ?? null,
  };
}

function normalizeDueTime(value: string): string {
  return /^\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
}

// ---- Entry ---------------------------------------------------------------

async function main(): Promise<void> {
  const resetOccurrences = process.argv.includes('--reset-occurrences');

  const ds = new DataSource(dataSourceOptions);
  await ds.initialize();
  console.log('[seed] connected to database');

  try {
    if (resetOccurrences) {
      // Wipes materialized occurrences so the app re-materializes with the
      // current household time_zone on next boot/tick. Use after changing TZ
      // or due_time semantics. FK references in transactions and
      // restriction_causes are ON DELETE SET NULL.
      console.log('[seed] resetting occurrences');
      await ds.query('DELETE FROM occurrences');
    }
    console.log('[seed] users + presence + devices');
    const users = await seedUsers(ds);
    console.log('[seed] categories');
    const categories = await seedCategories(ds);
    console.log('[seed] goals');
    await seedGoals(ds, users, categories);
    console.log('[seed] recurring tasks');
    await seedTasks(ds, users);
    console.log('[seed] done');
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
