import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { CLOCK, Clock } from '../clock/clock';
import { OccurrenceEntity } from './occurrence.entity';
import { TaskEntity, TaskKind } from './task.entity';
import { TasksService } from './tasks.service';
import { TransactionsService } from '../transactions/transactions.service';
import { expand } from './recurrence';
import { MissService } from './miss.service';
import { ResolutionService } from './resolution';
import { PresenceService } from '../presence/presence.service';
import { isSuppressed } from '../presence/presence-resolver';
import {
  DEFAULT_TIME_ZONE,
  HouseholdSettingsService,
} from '../household-settings/household-settings.service';
import {
  endOfDayInTz,
  hourInTz,
  isoDateInTz,
  startOfDayInTz,
  utcInstantFor,
  wallClockInTz,
  Ymd,
  ymdInTz,
} from '../clock/tz';

export type TimeOfDayBucket = 'morning' | 'after_school' | 'evening';

export interface OccurrenceView {
  id: string;
  task_id: string;
  user_id: string;
  scheduled_at: string;
  task_name: string;
  task_icon: string | null;
  task_kind: TaskKind;
  task_points: number;
  bucket: TimeOfDayBucket;
  // Wall-clock time (12-hour, e.g. `4:45 PM`) of scheduled_at in the household
  // time zone. The tablet renders this verbatim so the time it shows matches
  // what the admin typed as the due_time — independent of the browser's own
  // time zone.
  display_time: string;
  auto_complete: boolean; // reminders only: scheduled_at <= now
  status:
    | 'active'
    | 'auto_complete'
    | 'complete'
    | 'pending_review'
    | 'excused'
    | 'missed';
  // Set on missed occurrences whose task allows late completion AND the
  // window is still open. ISO instant at which the affordance closes; the
  // tablet renders a countdown to this moment.
  late_complete_until?: string;
  // ADR-0003: derived on read from the Trackee's Presence schedule. When
  // true, the tablet renders the Away badge and rule effects are treated
  // as Excused.
  presence_suppressed?: boolean;
  // Windowed-only: the deadline (Miss fires here). scheduled_at is the
  // window_start. Used by the tablet to render "by HH:MM" / "Up next".
  window_end?: string;
  // Windowed-only: wall-clock time (12-hour, e.g. `4:45 PM`) of window_end in
  // the household tz, the counterpart to display_time for the deadline the
  // tablet shows.
  window_end_display?: string;
}

@Injectable()
export class OccurrencesService {
  private readonly logger = new Logger('OccurrencesService');

  constructor(
    @InjectRepository(OccurrenceEntity)
    private readonly occurrences: Repository<OccurrenceEntity>,
    private readonly tasks: TasksService,
    private readonly transactions: TransactionsService,
    private readonly miss: MissService,
    private readonly resolution: ResolutionService,
    @Inject(forwardRef(() => PresenceService))
    private readonly presence: PresenceService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly householdSettings?: HouseholdSettingsService,
  ) {}

  /**
   * Household time zone — the single civil-time zone for all day/time math.
   * Falls back to {@link DEFAULT_TIME_ZONE} when settings aren't wired in
   * (unit tests) so every code path has a concrete zone rather than silently
   * reverting to the API process's own zone.
   */
  private async tz(): Promise<string> {
    if (!this.householdSettings) return DEFAULT_TIME_ZONE;
    try {
      return await this.householdSettings.timeZone();
    } catch {
      return DEFAULT_TIME_ZONE;
    }
  }

  /** Inclusive [start, end] UTC instants bracketing the household civil day of `date`. */
  private dayWindow(date: Date, tz: string): { start: Date; end: Date } {
    const ymd = ymdInTz(date, tz);
    return { start: startOfDayInTz(ymd, tz), end: endOfDayInTz(ymd, tz) };
  }

  /**
   * Idempotently create one occurrence per (active reminder/recurring task ×
   * active assignee) for the given local-server date. Safe to call
   * repeatedly; the `uq_occ_task_user_day` index suppresses duplicates.
   */
  async generateForDate(date: Date): Promise<{ created: number }> {
    const tz = await this.tz();
    let created = 0;
    created += await this.generateForReminderTasks(date, tz);
    created += await this.generateForRecurringTasks(date, tz);
    created += await this.generateForRecurringWindowedTasks(date, tz);
    if (created > 0) {
      this.logger.log(`generated ${created} occurrence(s)`);
    }
    return { created };
  }

  /**
   * Re-anchor existing occurrences after the household time zone changes.
   *
   * A task's `due_time` (and a recurring-windowed task's window offsets) are
   * wall-clock values *in the household zone*. When the admin changes that
   * zone, the wall-clock meaning must be preserved — a reminder due `20:00`
   * stays `20:00`, which means its UTC `scheduled_at` has to move. Occurrence
   * generation is idempotent on `local_day`, so the generator alone never
   * rewrites already-materialized rows; this method does it explicitly.
   *
   * Scope: occurrences on or after the current household-local day. Past days
   * are left as the historical record under the zone that was active then.
   * One-shot windowed occurrences are skipped — their times are absolute
   * instants the admin picked directly, not derived from a wall-clock we can
   * reconstruct.
   */
  async reanchorToTimeZone(tz: string): Promise<{ updated: number }> {
    const today = isoDateInTz(this.clock.now(), tz);
    const rows = await this.occurrences.find({
      where: { localDay: MoreThanOrEqual(today) },
      relations: { task: true },
    });
    let updated = 0;
    for (const occ of rows) {
      if (!occ.task) continue;
      if (reanchorOccurrence(occ, occ.task, tz)) {
        await this.occurrences.save(occ);
        updated += 1;
      }
    }
    // Materialize any occurrence the new zone now makes valid (idempotent;
    // re-anchored rows already carry the correct local_day so they're skipped).
    await this.generateForDate(this.clock.now()).catch(() => undefined);
    if (updated > 0) {
      this.logger.log(`re-anchored ${updated} occurrence(s) to ${tz}`);
    }
    return { updated };
  }

  /**
   * Materialize the single occurrence for a one-shot windowed task. Called
   * by the controller right after the task row is saved. Uses the absolute
   * window_start / window_end timestamps the admin supplied.
   */
  async createOneShotWindowedOccurrence(
    task: TaskEntity,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<number> {
    const tz = await this.tz();
    const localDay = isoDateInTz(windowStart, tz);
    let created = 0;
    for (const assignee of task.assignees) {
      if (assignee.deactivatedAt) continue;
      const existing = await this.occurrences.findOne({
        where: { taskId: task.id, userId: assignee.id },
      });
      if (existing) continue;
      await this.occurrences.save(
        this.occurrences.create({
          taskId: task.id,
          userId: assignee.id,
          scheduledAt: windowStart,
          windowEnd,
          localDay,
          status: 'active',
        }),
      );
      created += 1;
    }
    return created;
  }

  private async generateForRecurringWindowedTasks(
    date: Date,
    tz: string,
  ): Promise<number> {
    const tasks = await this.tasks.activeRecurringWindowedTasks();
    let created = 0;
    const range = { from: civilDayToken(date, tz), to: civilDayToken(date, tz) };
    // Cadence anchor = household-local midnight of the day. The two offsets
    // produce window_start and window_end relative to that anchor.
    const anchor = startOfDayInTz(ymdInTz(date, tz), tz);
    for (const task of tasks) {
      if (!task.recurrence) continue;
      if (
        task.windowStartOffsetMinutes == null ||
        task.windowEndOffsetMinutes == null
      ) {
        continue;
      }
      const hits = expand(task.recurrence, range);
      if (hits.length === 0) continue;
      const windowStart = new Date(
        anchor.getTime() + task.windowStartOffsetMinutes * 60_000,
      );
      const windowEnd = new Date(
        anchor.getTime() + task.windowEndOffsetMinutes * 60_000,
      );
      const localDay = isoDateInTz(windowStart, tz);
      for (const assignee of task.assignees) {
        if (assignee.deactivatedAt) continue;
        const existing = await this.occurrences.findOne({
          where: { taskId: task.id, userId: assignee.id, localDay },
        });
        if (existing) continue;
        await this.occurrences.save(
          this.occurrences.create({
            taskId: task.id,
            userId: assignee.id,
            scheduledAt: windowStart,
            windowEnd,
            localDay,
            status: 'active',
          }),
        );
        created += 1;
      }
    }
    return created;
  }

  private async generateForReminderTasks(
    date: Date,
    tz: string,
  ): Promise<number> {
    const tasks = await this.tasks.activeReminderTasks();
    let created = 0;
    const range = { from: civilDayToken(date, tz), to: civilDayToken(date, tz) };
    for (const task of tasks) {
      // A reminder with a recurrence fires only on its cadence-hit days
      // (mirrors recurring tasks). A null recurrence is the legacy
      // "every day" reminder — preserved for back-compat.
      if (task.recurrence && expand(task.recurrence, range).length === 0) {
        continue;
      }
      for (const assignee of task.assignees) {
        if (assignee.deactivatedAt) continue;
        if (await this.createIfMissing(task, assignee.id, date, tz)) created += 1;
      }
    }
    return created;
  }

  private async generateForRecurringTasks(
    date: Date,
    tz: string,
  ): Promise<number> {
    const tasks = await this.tasks.activeRecurringTasks();
    let created = 0;
    const range = { from: civilDayToken(date, tz), to: civilDayToken(date, tz) };
    for (const task of tasks) {
      if (!task.recurrence) continue;
      const hits = expand(task.recurrence, range);
      if (hits.length === 0) continue;
      for (const assignee of task.assignees) {
        if (assignee.deactivatedAt) continue;
        if (await this.createIfMissing(task, assignee.id, date, tz)) created += 1;
      }
    }
    return created;
  }

  private async createIfMissing(
    task: TaskEntity,
    userId: string,
    date: Date,
    tz: string,
  ): Promise<boolean> {
    const scheduledAt = combineDateAndDueTime(date, task.dueTime, tz);
    const localDay = isoDateInTz(scheduledAt, tz);
    const existing = await this.occurrences.findOne({
      where: { taskId: task.id, userId, localDay },
    });
    if (existing) return false;
    await this.occurrences.save(
      this.occurrences.create({
        taskId: task.id,
        userId,
        scheduledAt,
        localDay,
        status: 'active',
      }),
    );
    return true;
  }

  /** Reminder + recurring + windowed occurrences for one Trackee on one
   *  local-server date.
   *
   *  Anchoring rules:
   *    - reminder/recurring: anchored by `scheduled_at`'s day.
   *    - windowed: anchored by `window_end`'s day (the Miss day; the streak
   *      counts on this day). Filtered out when `window_start > now` so
   *      they don't render before they're actionable.
   */
  async forTrackeeOnDate(
    userId: string,
    date: Date,
    now: Date = this.clock.now(),
  ): Promise<OccurrenceView[]> {
    const tz = await this.tz();
    const { start: dayStart, end: dayEnd } = this.dayWindow(date, tz);
    const rows = await this.occurrences
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.task', 't')
      .where('o.user_id = :userId', { userId })
      .andWhere(
        '((o.window_end IS NULL AND o.scheduled_at BETWEEN :dayStart AND :dayEnd) ' +
          'OR (o.window_end IS NOT NULL AND o.window_end BETWEEN :dayStart AND :dayEnd))',
        { dayStart, dayEnd },
      )
      .orderBy('COALESCE(o.window_end, o.scheduled_at)', 'ASC')
      .getMany();
    const schedule = await this.presence.findByUserId(userId).catch(() => null);
    return rows
      .filter((o) => o.task)
      .filter((o) => {
        // Hide windowed occurrences whose window hasn't opened yet.
        if (o.task.kind !== 'windowed') return true;
        return o.scheduledAt.getTime() <= now.getTime();
      })
      .map((o) => {
        const view = toView(o, now, tz);
        if (schedule && isSuppressed(schedule, o.scheduledAt, tz)) {
          view.presence_suppressed = true;
        }
        return view;
      });
  }

  /**
   * "Up next" rail for the tablet: windowed occurrences (across all the
   * Trackee's assignments) whose window opens within the next 24h and
   * isn't yet visible on the routine board.
   */
  async upNextWindowedForTrackee(
    userId: string,
    now: Date = this.clock.now(),
  ): Promise<OccurrenceView[]> {
    const horizon = new Date(now.getTime() + 24 * 60 * 60_000);
    const rows = await this.occurrences
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.task', 't')
      .where('o.user_id = :userId', { userId })
      .andWhere('t.kind = :kind', { kind: 'windowed' })
      .andWhere('o.scheduled_at > :now', { now })
      .andWhere('o.scheduled_at <= :horizon', { horizon })
      .andWhere("o.status = 'active'")
      .orderBy('o.scheduled_at', 'ASC')
      .getMany();
    const tz = await this.tz();
    return rows.filter((o) => o.task).map((o) => toView(o, now, tz));
  }

  /**
   * Mark a recurring-task occurrence complete and post an `earn` transaction
   * for the task's `points` value. If the task is flagged
   * `requires_verification`, the occurrence enters `pending_review` instead
   * of `complete` — the earn transaction is posted optimistically and waits
   * on an Admin approve/reject (ADR-0002). Idempotent for both paths.
   */
  async markComplete(occurrenceId: string): Promise<OccurrenceEntity> {
    // We need to peek at the task to decide which intent to fire; the
    // applier's snapshot also reads it, but that's a tiny duplication for a
    // hot-path decision the controller can't make.
    const occ = await this.occurrences.findOne({
      where: { id: occurrenceId },
      relations: { task: true },
    });
    if (!occ) throw new NotFoundException(`occurrence ${occurrenceId} not found`);
    if (!occ.task) {
      throw new BadRequestException(
        `occurrence ${occurrenceId} has no associated task`,
      );
    }
    const intent = occ.task.requiresVerification === true
      ? { kind: 'submit_for_review' as const }
      : { kind: 'mark_clean' as const };
    const { occurrence } = await this.resolution.apply(occurrenceId, intent);
    return occurrence;
  }
}

export function toView(
  occ: OccurrenceEntity & { task: TaskEntity },
  now: Date,
  tz: string,
): OccurrenceView {
  const kind = occ.task.kind;
  if (kind === 'reminder') {
    const autoComplete = isAutoComplete(occ.scheduledAt, now);
    return {
      id: occ.id,
      task_id: occ.taskId,
      user_id: occ.userId,
      scheduled_at: occ.scheduledAt.toISOString(),
      task_name: occ.task.name,
      task_icon: occ.task.icon,
      task_kind: 'reminder',
      task_points: 0,
      bucket: bucketFor(occ.scheduledAt, tz),
      display_time: displayTime(occ.scheduledAt, tz),
      auto_complete: autoComplete,
      status: autoComplete ? 'auto_complete' : 'active',
    };
  }
  // recurring + windowed share the same status / lifecycle.
  let status: OccurrenceView['status'];
  if (occ.status === 'complete') status = 'complete';
  else if (occ.status === 'pending_review') status = 'pending_review';
  else if (occ.status === 'excused') status = 'excused';
  else if (occ.status === 'missed') status = 'missed';
  else status = 'active';
  let lateCompleteUntil: string | undefined;
  if (
    kind === 'recurring' &&
    occ.status === 'missed' &&
    occ.task.allowLateCompletion
  ) {
    const closesAtMs =
      occ.scheduledAt.getTime() + (occ.task.lateWindowMinutes ?? 720) * 60_000;
    if (closesAtMs > now.getTime()) {
      lateCompleteUntil = new Date(closesAtMs).toISOString();
    }
  }
  // Windowed anchors visually on window_end (the Miss day) — bucketing
  // mirrors that so the routine board shows it under the right section.
  const bucketAnchor =
    kind === 'windowed' && occ.windowEnd ? occ.windowEnd : occ.scheduledAt;
  return {
    id: occ.id,
    task_id: occ.taskId,
    user_id: occ.userId,
    scheduled_at: occ.scheduledAt.toISOString(),
    task_name: occ.task.name,
    task_icon: occ.task.icon,
    task_kind: kind,
    task_points: occ.task.points,
    bucket: bucketFor(bucketAnchor, tz),
    display_time: displayTime(occ.scheduledAt, tz),
    auto_complete: false,
    status,
    ...(lateCompleteUntil ? { late_complete_until: lateCompleteUntil } : {}),
    ...(occ.windowEnd ? { window_end: occ.windowEnd.toISOString() } : {}),
    ...(occ.windowEnd
      ? { window_end_display: displayTime(occ.windowEnd, tz) }
      : {}),
  };
}

/**
 * The auto-complete rule: reminder occurrences render as ✓ once their
 * scheduled instant is at-or-past `now`. The threshold is inclusive — a
 * reminder pinned to 08:00 renders ✓ from 08:00:00.000 onward.
 */
export function isAutoComplete(scheduledAt: Date, now: Date): boolean {
  return scheduledAt.getTime() <= now.getTime();
}

/**
 * Bucketing matches the tablet's Morning / After school / Evening sections.
 * Boundaries are inclusive of the lower edge and not yet configurable per
 * household.
 *
 * The hour is read in the household time zone, so a `11:45` due_time buckets
 * as morning regardless of the API process's own zone.
 */
export function bucketFor(scheduledAt: Date, tz: string): TimeOfDayBucket {
  const hour = hourInTz(scheduledAt, tz);
  if (hour < 12) return 'morning';
  if (hour < 17) return 'after_school';
  return 'evening';
}

/** Wall-clock `HH:MM` the tablet should display for `instant`, in the household tz. */
function displayTime(instant: Date, tz: string): string {
  return wallClockInTz(instant, tz);
}

/**
 * Recompute an occurrence's `scheduled_at` / `window_end` / `local_day` so its
 * wall-clock meaning holds in `tz`, anchored to its existing civil day
 * (`local_day`). Mutates `occ` in place; returns whether anything changed.
 * Returns `false` (no-op) for one-shot windowed occurrences, whose timestamps
 * are absolute admin-picked instants rather than a reconstructable wall-clock.
 */
export function reanchorOccurrence(
  occ: OccurrenceEntity,
  task: TaskEntity,
  tz: string,
): boolean {
  const ymd = ymdFromIsoDate(occ.localDay);
  if (task.kind === 'windowed') {
    if (
      task.recurrence == null ||
      task.windowStartOffsetMinutes == null ||
      task.windowEndOffsetMinutes == null
    ) {
      return false;
    }
    const anchor = startOfDayInTz(ymd, tz);
    const nextStart = new Date(
      anchor.getTime() + task.windowStartOffsetMinutes * 60_000,
    );
    const nextEnd = new Date(
      anchor.getTime() + task.windowEndOffsetMinutes * 60_000,
    );
    const nextLocalDay = isoDateInTz(nextStart, tz);
    if (
      occ.scheduledAt.getTime() === nextStart.getTime() &&
      occ.windowEnd?.getTime() === nextEnd.getTime() &&
      occ.localDay === nextLocalDay
    ) {
      return false;
    }
    occ.scheduledAt = nextStart;
    occ.windowEnd = nextEnd;
    occ.localDay = nextLocalDay;
    return true;
  }
  // reminder + recurring: scheduled_at is the due_time wall-clock on this day.
  const next = combineDateAndDueTimeYmd(ymd, task.dueTime, tz);
  const nextLocalDay = isoDateInTz(next, tz);
  if (
    occ.scheduledAt.getTime() === next.getTime() &&
    occ.localDay === nextLocalDay
  ) {
    return false;
  }
  occ.scheduledAt = next;
  occ.localDay = nextLocalDay;
  return true;
}

/** Parse a stored `local_day` (`YYYY-MM-DD`) into a 0-indexed-month {@link Ymd}. */
function ymdFromIsoDate(iso: string): Ymd {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month: month - 1, day };
}

/** Like {@link combineDateAndDueTime} but anchored to an explicit civil day. */
function combineDateAndDueTimeYmd(ymd: Ymd, dueTime: string, tz: string): Date {
  const parts = dueTime.split(':').map(Number);
  const hh = parts[0] ?? 0;
  const mm = parts[1] ?? 0;
  const ss = parts[2] ?? 0;
  return utcInstantFor(ymd.year, ymd.month, ymd.day, hh, mm, ss, tz);
}

export function combineDateAndDueTime(
  date: Date,
  dueTime: string,
  tz: string,
): Date {
  // dueTime is 'HH:MM' or 'HH:MM:SS' wall-clock time-of-day, interpreted in the
  // household IANA zone and converted to a UTC instant (so `due_time = 11:30`
  // with tz `America/Los_Angeles` becomes 18:30 UTC during PDT). The calendar
  // day is the civil day of `date` as observed in that zone.
  const parts = dueTime.split(':').map(Number);
  const hh = parts[0] ?? 0;
  const mm = parts[1] ?? 0;
  const ss = parts[2] ?? 0;
  const ymd = ymdInTz(date, tz);
  return utcInstantFor(ymd.year, ymd.month, ymd.day, hh, mm, ss, tz);
}

/**
 * A "civil-day token" the timezone-agnostic recurrence engine can match on.
 * The engine reads runtime-local calendar fields (`getFullYear/getMonth/
 * getDate/getDay`); constructing the Date from the household civil Y/M/D makes
 * those reads yield the household civil date, so pattern matching ("does this
 * fire today?") is evaluated against the household day — not the process zone.
 */
function civilDayToken(date: Date, tz: string): Date {
  const { year, month, day } = ymdInTz(date, tz);
  return new Date(year, month, day);
}
