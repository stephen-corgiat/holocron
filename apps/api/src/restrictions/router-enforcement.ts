/**
 * Tiny HTTP client interface so tests can substitute a fake. The adapter
 * never reaches for `fetch` directly — it goes through this port.
 */
export interface RouterHttpClient {
  request(
    method: 'GET' | 'POST',
    url: string,
    headers: Record<string, string>,
  ): Promise<RouterHttpResponse>;
}

export interface RouterHttpResponse {
  status: number;
  ok: boolean;
  /** Stringified body — the EdgeRouter responses are small JSON blobs. */
  body: string;
}

export const ROUTER_HTTP_CLIENT = Symbol('ROUTER_HTTP_CLIENT');
export const ROUTER_ENFORCEMENT_CONFIG = Symbol('ROUTER_ENFORCEMENT_CONFIG');

export interface RouterEnforcementConfig {
  baseUrl: string;
  bearerToken: string;
}

/**
 * Adapter for an EdgeRouter X exposing per-scope ipset endpoints. The
 * endpoints accept a single `ip` query param and return idempotent results.
 */
export class FetchRouterHttpClient implements RouterHttpClient {
  async request(
    method: 'GET' | 'POST',
    url: string,
    headers: Record<string, string>,
  ): Promise<RouterHttpResponse> {
    const res = await fetch(url, { method, headers });
    const body = await res.text();
    return { status: res.status, ok: res.ok, body };
  }
}
