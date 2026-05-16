import { Inject, Injectable } from '@nestjs/common';
import { HA_CONFIG, HaConfig } from './ha-config';

/**
 * A single HA entity state, as returned by `GET /api/states`. We keep only
 * the fields the shaping needs; HA sends much more, but none of it crosses
 * the seam to the tablet.
 */
export interface HaEntityState {
  entity_id: string;
  state: string;
  attributes?: {
    friendly_name?: string;
    device_class?: string;
    [key: string]: unknown;
  };
}

/**
 * Tiny port over HA's REST API so tests can substitute a fake — the proxy
 * never reaches for `fetch` directly (mirrors `RouterHttpClient`). The bearer
 * token lives only inside the adapter.
 */
export interface HaHttpClient {
  /** `GET /api/states` → all entity states. */
  getStates(): Promise<HaEntityState[]>;
  /** `POST /api/services/<domain>/<service>` with a JSON body. */
  callService(
    domain: string,
    service: string,
    data: Record<string, unknown>,
  ): Promise<void>;
  /**
   * `POST /api/services/<domain>/<service>?return_response` — a service that
   * returns data (e.g. `weather.get_forecasts`). HA wraps it as
   * `{ service_response: { <entity_id>: { forecast: [...] } } }`. Used by the
   * weather slow-poll; returns HA's **cached** forecast (no provider round-trip).
   */
  callServiceWithResponse(
    domain: string,
    service: string,
    data: Record<string, unknown>,
  ): Promise<unknown>;
}

export const HA_HTTP_CLIENT = Symbol('HA_HTTP_CLIENT');

/** Real adapter: `fetch` against the LAN HA instance with the bearer token. */
@Injectable()
export class FetchHaHttpClient implements HaHttpClient {
  constructor(@Inject(HA_CONFIG) private readonly config: HaConfig) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Read HA's error-response body so the thrown message names *why* a non-2xx
   * happened, not just the bare status. A service call that HA rejects — an
   * invalid `preset_mode`, an unknown `entity_id` — comes back as a 4xx/5xx
   * whose body carries the explanation (e.g. `Preset mode low is not valid,
   * valid preset modes are: ['Auto', 'Low', 'High']`). Without this the log
   * shows only `failed: 500` and the misconfiguration is invisible. Tolerant
   * of an empty/unreadable body (⇒ status alone).
   */
  private async describeFailure(res: Response): Promise<string> {
    let body = '';
    try {
      body = (await res.text()).trim();
    } catch {
      // body already consumed or stream errored — fall back to status only
    }
    return body ? `${res.status}: ${body}` : `${res.status}`;
  }

  async getStates(): Promise<HaEntityState[]> {
    const res = await fetch(`${this.config.baseUrl}/api/states`, {
      method: 'GET',
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(
        `HA GET /api/states failed: ${await this.describeFailure(res)}`,
      );
    }
    return (await res.json()) as HaEntityState[];
  }

  async callService(
    domain: string,
    service: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const res = await fetch(
      `${this.config.baseUrl}/api/services/${domain}/${service}`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(data),
      },
    );
    if (!res.ok) {
      throw new Error(
        `HA POST /api/services/${domain}/${service} failed: ${await this.describeFailure(res)}`,
      );
    }
  }

  async callServiceWithResponse(
    domain: string,
    service: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    const res = await fetch(
      `${this.config.baseUrl}/api/services/${domain}/${service}?return_response`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(data),
      },
    );
    if (!res.ok) {
      throw new Error(
        `HA POST /api/services/${domain}/${service} (return_response) failed: ${await this.describeFailure(res)}`,
      );
    }
    return res.json();
  }
}
