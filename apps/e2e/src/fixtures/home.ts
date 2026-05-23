import type { ApiClient } from './api-client';

export interface HaServiceCall {
  domain: string;
  service: string;
  data: Record<string, unknown>;
  at: string;
}

/**
 * Drives the in-memory HA fake (REST + `state_changed`) so home-surface specs
 * never touch the real instance or command a real device. `setState` both
 * updates the fake's REST view and fires a live `state_changed` — use it for
 * both software-confirmed toggles and simulated physical flips.
 */
export function homeFixture(api: ApiClient) {
  return {
    async setState(
      entityId: string,
      state: string,
      attributes?: Record<string, unknown>,
    ): Promise<void> {
      await api.post('/_e2e/ha/state', {
        entity_id: entityId,
        state,
        attributes,
      });
    },
    async serviceCalls(): Promise<HaServiceCall[]> {
      const res = await api.get<{ calls: HaServiceCall[] }>('/_e2e/ha/log');
      return res.calls;
    },
    /**
     * Seed the canned cached forecast a later `weather.get_forecasts` reflects
     * (HA shape: `[{ condition, templow, temperature }, ...]`; first = today).
     * Never hits a real provider — the fake just reflects this.
     */
    async setForecast(entityId: string, forecast: unknown[]): Promise<void> {
      await api.post('/_e2e/ha/forecast', { entity_id: entityId, forecast });
    },
    /**
     * Force a weather slow-poll (the production timer is off under
     * E2E_TEST_MODE) so the cached forecast folds into the live `weather` block.
     */
    async forecastPoll(): Promise<void> {
      await api.post('/_e2e/ha/forecast-poll');
    },
    async reset(): Promise<void> {
      await api.post('/_e2e/ha/reset');
    },
  };
}

export type HomeFixture = ReturnType<typeof homeFixture>;
