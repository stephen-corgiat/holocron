import { Injectable } from '@nestjs/common';
import { HaEntityState, HaHttpClient } from '../ha/ha-http-client';

export interface FakeHaServiceCall {
  domain: string;
  service: string;
  data: Record<string, unknown>;
  at: string;
}

/**
 * In-memory HA REST fake. Holds whatever states the e2e suite drives in and
 * records every service call so a test can assert "the toggle hit the fake"
 * — and, by construction, **never** issues a real HA service call or touches
 * a real device. Mirrors {@link FakeRouterHttpClient}.
 */
@Injectable()
export class FakeHaHttpClient implements HaHttpClient {
  private readonly states = new Map<string, HaEntityState>();
  private readonly calls: FakeHaServiceCall[] = [];
  /** Canned cached forecast reflected by `weather.get_forecasts` per entity. */
  private readonly forecasts = new Map<string, unknown[]>();

  async getStates(): Promise<HaEntityState[]> {
    return [...this.states.values()];
  }

  async callService(
    domain: string,
    service: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    this.calls.push({ domain, service, data, at: new Date().toISOString() });
  }

  /**
   * Records the call (so a test can assert the slow-poll fired) and reflects a
   * **canned cached forecast** — never a real provider round-trip. Returns the
   * HA-shaped `{ service_response: { <entity_id>: { forecast: [...] } } }`.
   */
  async callServiceWithResponse(
    domain: string,
    service: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    this.calls.push({ domain, service, data, at: new Date().toISOString() });
    const entityId = String(data.entity_id ?? '');
    const forecast = this.forecasts.get(entityId) ?? [];
    return { service_response: { [entityId]: { forecast } } };
  }

  // ── e2e drivers ──────────────────────────────────────────────────────────
  setState(state: HaEntityState): void {
    this.states.set(state.entity_id, state);
  }

  removeState(entityId: string): void {
    this.states.delete(entityId);
  }

  /** Seed the canned forecast an entity's `get_forecasts` will reflect. */
  setForecast(entityId: string, forecast: unknown[]): void {
    this.forecasts.set(entityId, forecast);
  }

  getCalls(): FakeHaServiceCall[] {
    return [...this.calls];
  }

  reset(): void {
    this.states.clear();
    this.calls.length = 0;
    this.forecasts.clear();
  }
}
