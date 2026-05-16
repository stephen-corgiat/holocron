/**
 * HTTP port for the PiHole REST API. The PiHole adapter never reaches for
 * `fetch` directly; tests swap in a fake.
 *
 * The PiHole API is more involved than the router's: it requires session
 * auth (`POST /api/auth`) returning a `sid`, and write operations PUT a
 * full client representation. The HTTP client port stays generic — the
 * service layer handles the protocol.
 */
export interface PiHoleHttpClient {
  request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<PiHoleHttpResponse>;
}

export interface PiHoleHttpResponse {
  status: number;
  ok: boolean;
  body: string;
}

export const PIHOLE_HTTP_CLIENT = Symbol('PIHOLE_HTTP_CLIENT');
export const PIHOLE_ENFORCEMENT_CONFIG = Symbol('PIHOLE_ENFORCEMENT_CONFIG');

export interface PiHoleEnforcementConfig {
  baseUrl: string;
  apiPassword: string;
  /**
   * Maps each PiHole-backed Restriction scope to the *name* of the PiHole
   * group that, when assigned to a client, blocks the relevant category at
   * the DNS layer. Group IDs are resolved at module init by name.
   */
  groupNamesByScope: {
    games: string;
    entertainment: string;
  };
}

export class FetchPiHoleHttpClient implements PiHoleHttpClient {
  async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<PiHoleHttpResponse> {
    const res = await fetch(url, { method, headers, body });
    const text = await res.text();
    return { status: res.status, ok: res.ok, body: text };
  }
}
