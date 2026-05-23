import { request, type APIRequestContext } from '@playwright/test';

const API_URL = process.env.HOLOCRON_API_URL ?? 'http://127.0.0.1:3000';

export interface ApiClient {
  url: (path: string) => string;
  get: <T = unknown>(path: string, token?: string) => Promise<T>;
  post: <T = unknown>(
    path: string,
    body?: unknown,
    token?: string,
  ) => Promise<T>;
  patch: <T = unknown>(
    path: string,
    body?: unknown,
    token?: string,
  ) => Promise<T>;
  delete: (path: string, token?: string) => Promise<void>;
  raw: APIRequestContext;
}

/**
 * Light fetch wrapper around the API. Tests use this for both `/_e2e/*`
 * test endpoints and real domain endpoints (e.g. `/restrictions/block-now`)
 * where exercising the UI for every assertion would be overkill.
 */
export async function makeApi(): Promise<ApiClient> {
  const raw = await request.newContext({ baseURL: API_URL });
  const headers = (token?: string) => ({
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });
  return {
    raw,
    url: (path) => `${API_URL}${path}`,
    async get<T>(path: string, token?: string): Promise<T> {
      const res = await raw.get(path, { headers: headers(token) });
      assertOk(res.status(), 'GET', path, await res.text());
      return res.json();
    },
    async post<T>(path: string, body?: unknown, token?: string): Promise<T> {
      const res = await raw.post(path, {
        headers: headers(token),
        data: body !== undefined ? JSON.stringify(body) : undefined,
      });
      assertOk(res.status(), 'POST', path, await res.text());
      if (res.status() === 204) return undefined as T;
      return res.json();
    },
    async patch<T>(path: string, body?: unknown, token?: string): Promise<T> {
      const res = await raw.patch(path, {
        headers: headers(token),
        data: body !== undefined ? JSON.stringify(body) : undefined,
      });
      assertOk(res.status(), 'PATCH', path, await res.text());
      return res.json();
    },
    async delete(path: string, token?: string): Promise<void> {
      const res = await raw.delete(path, { headers: headers(token) });
      assertOk(res.status(), 'DELETE', path, await res.text());
    },
  };
}

function assertOk(status: number, method: string, path: string, body: string) {
  if (status >= 200 && status < 300) return;
  throw new Error(`${method} ${path} → ${status}: ${body.slice(0, 500)}`);
}
