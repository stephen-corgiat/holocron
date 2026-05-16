import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HouseholdSettingsEntity } from './household-settings.entity';

export interface HouseholdSettingsView {
  pending_review_timeout_hours: number;
  time_zone: string;
  cash_out_rate: number;
  audible_warning_at: string | null;
  daily_bonus_amount: number;
}

const DEFAULT_TIMEOUT_HOURS = 48;
export const DEFAULT_TIME_ZONE = 'America/Los_Angeles';
const DEFAULT_CASH_OUT_RATE = 0.1;
export const DEFAULT_DAILY_BONUS = 5;

/**
 * Single-row settings table (PK = 1 enforced by CHECK constraint). The service
 * normalises pending_review_timeout into milliseconds for callers — Postgres
 * INTERVAL deserialises as a `PostgresInterval` object via node-postgres.
 */
/** Listener invoked when the household time zone actually changes. */
export type TimeZoneChangeListener = (tz: string) => Promise<void> | void;

@Injectable()
export class HouseholdSettingsService {
  // Registered by feature modules (e.g. TasksModule) that must react to a
  // zone change. Kept here — rather than wiring settings → tasks directly — so
  // the dependency only runs one way (tasks imports settings) and no module
  // cycle is introduced.
  private readonly tzChangeListeners: TimeZoneChangeListener[] = [];

  constructor(
    @InjectRepository(HouseholdSettingsEntity)
    private readonly settings: Repository<HouseholdSettingsEntity>,
  ) {}

  /** Subscribe to household time-zone changes. Listeners fire after the row is saved. */
  onTimeZoneChange(listener: TimeZoneChangeListener): void {
    this.tzChangeListeners.push(listener);
  }

  private async ensureRow(): Promise<HouseholdSettingsEntity> {
    let row = await this.settings.findOne({ where: { id: 1 } });
    if (!row) {
      row = this.settings.create({ id: 1 });
      row = await this.settings.save(row);
    }
    return row;
  }

  async view(): Promise<HouseholdSettingsView> {
    const row = await this.ensureRow();
    const ms = intervalToMs(row.pendingReviewTimeout);
    return {
      pending_review_timeout_hours: msToHours(ms),
      time_zone: row.timeZone ?? DEFAULT_TIME_ZONE,
      cash_out_rate: row.cashOutRate ?? DEFAULT_CASH_OUT_RATE,
      audible_warning_at: row.audibleWarningAt ?? null,
      daily_bonus_amount: row.dailyBonusAmount ?? DEFAULT_DAILY_BONUS,
    };
  }

  async audibleWarningAt(): Promise<string | null> {
    const row = await this.ensureRow();
    return row.audibleWarningAt ?? null;
  }

  async audibleWarningLastFiredOn(): Promise<string | null> {
    const row = await this.ensureRow();
    return row.audibleWarningLastFiredOn ?? null;
  }

  async markAudibleWarningFired(isoDate: string): Promise<void> {
    const row = await this.ensureRow();
    row.audibleWarningLastFiredOn = isoDate;
    await this.settings.save(row);
  }

  async updateAudibleWarningAt(
    value: string | null,
  ): Promise<HouseholdSettingsView> {
    const row = await this.ensureRow();
    row.audibleWarningAt = value;
    await this.settings.save(row);
    return this.view();
  }

  async pendingReviewTimeoutMs(): Promise<number> {
    const row = await this.ensureRow();
    return intervalToMs(row.pendingReviewTimeout);
  }

  async timeZone(): Promise<string> {
    const row = await this.ensureRow();
    return row.timeZone ?? DEFAULT_TIME_ZONE;
  }

  async cashOutRate(): Promise<number> {
    const row = await this.ensureRow();
    return row.cashOutRate ?? DEFAULT_CASH_OUT_RATE;
  }

  async dailyBonusAmount(): Promise<number> {
    const row = await this.ensureRow();
    return row.dailyBonusAmount ?? DEFAULT_DAILY_BONUS;
  }

  async updateTimeoutHours(hours: number): Promise<HouseholdSettingsView> {
    const row = await this.ensureRow();
    row.pendingReviewTimeout = `${hours} hours`;
    await this.settings.save(row);
    return this.view();
  }

  async updateTimeZone(tz: string): Promise<HouseholdSettingsView> {
    const row = await this.ensureRow();
    const previous = row.timeZone ?? DEFAULT_TIME_ZONE;
    row.timeZone = tz;
    await this.settings.save(row);
    if (tz !== previous) {
      for (const listener of this.tzChangeListeners) {
        await listener(tz);
      }
    }
    return this.view();
  }

  async updateCashOutRate(rate: number): Promise<HouseholdSettingsView> {
    const row = await this.ensureRow();
    row.cashOutRate = rate;
    await this.settings.save(row);
    return this.view();
  }

  async updateDailyBonusAmount(amount: number): Promise<HouseholdSettingsView> {
    const row = await this.ensureRow();
    row.dailyBonusAmount = amount;
    await this.settings.save(row);
    return this.view();
  }
}

function intervalToMs(value: unknown): number {
  if (value === null || value === undefined) {
    return DEFAULT_TIMEOUT_HOURS * 3600_000;
  }
  if (typeof value === 'string') {
    // Could be 'HH:MM:SS', '1 day', etc. Parse just enough for our domain.
    const hhmmss = /^(\d+):(\d{2}):(\d{2})$/.exec(value);
    if (hhmmss) {
      return (
        Number(hhmmss[1]) * 3600_000 +
        Number(hhmmss[2]) * 60_000 +
        Number(hhmmss[3]) * 1000
      );
    }
    const hoursMatch = /^(\d+(?:\.\d+)?)\s*hour/.exec(value);
    if (hoursMatch) return Number(hoursMatch[1]) * 3600_000;
    const daysMatch = /^(\d+(?:\.\d+)?)\s*day/.exec(value);
    if (daysMatch) return Number(daysMatch[1]) * 24 * 3600_000;
    return DEFAULT_TIMEOUT_HOURS * 3600_000;
  }
  const v = value as {
    days?: number;
    hours?: number;
    minutes?: number;
    seconds?: number;
    milliseconds?: number;
  };
  const days = v.days ?? 0;
  const hours = v.hours ?? 0;
  const minutes = v.minutes ?? 0;
  const seconds = v.seconds ?? 0;
  const ms = v.milliseconds ?? 0;
  const total =
    days * 24 * 3600_000 +
    hours * 3600_000 +
    minutes * 60_000 +
    seconds * 1000 +
    ms;
  return total > 0 ? total : DEFAULT_TIMEOUT_HOURS * 3600_000;
}

function msToHours(ms: number): number {
  return Math.round((ms / 3600_000) * 100) / 100;
}
