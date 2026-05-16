import { Injectable } from '@nestjs/common';
import { HaEntityState } from './ha-http-client';
import { HaStatus } from './ha-snapshot';
import { ForecastToday } from './weather-forecast';

/**
 * In-memory mirror of the whitelisted HA entity states plus the live link
 * status. Seeded from `GET /api/states` when the WS connects, then kept
 * current by each `state_changed` event (HaEventsService). Reading the
 * snapshot from this store means a hand-flipped physical switch and a
 * software toggle converge on the same source of truth.
 */
@Injectable()
export class HaStateStore {
  private readonly states = new Map<string, HaEntityState>();
  private status: HaStatus = 'disconnected';
  private forecast: ForecastToday | null = null;

  replaceAll(states: HaEntityState[]): void {
    this.states.clear();
    for (const s of states) this.states.set(s.entity_id, s);
  }

  /** Look up a single entity's current state (or undefined when absent). */
  get(entityId: string): HaEntityState | undefined {
    return this.states.get(entityId);
  }

  /** Cached daily forecast from the weather slow-poll. */
  getForecast(): ForecastToday | null {
    return this.forecast;
  }

  setForecast(forecast: ForecastToday | null): void {
    this.forecast = forecast;
  }

  apply(state: HaEntityState): void {
    this.states.set(state.entity_id, state);
  }

  remove(entityId: string): void {
    this.states.delete(entityId);
  }

  all(): HaEntityState[] {
    return [...this.states.values()];
  }

  isEmpty(): boolean {
    return this.states.size === 0;
  }

  getStatus(): HaStatus {
    return this.status;
  }

  setStatus(status: HaStatus): void {
    this.status = status;
  }
}
