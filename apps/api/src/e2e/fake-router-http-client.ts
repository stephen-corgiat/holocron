import { Injectable } from '@nestjs/common';
import {
  RouterHttpClient,
  RouterHttpResponse,
} from '../restrictions/router-enforcement';

export interface FakeRouterCall {
  method: 'GET' | 'POST';
  url: string;
  at: string;
}

/**
 * In-memory router HTTP fake. Always replies 200 OK with `{ ok: true }`,
 * recording every call so the e2e suite can assert on it.
 */
@Injectable()
export class FakeRouterHttpClient implements RouterHttpClient {
  private readonly calls: FakeRouterCall[] = [];

  async request(
    method: 'GET' | 'POST',
    url: string,
    _headers: Record<string, string>,
  ): Promise<RouterHttpResponse> {
    this.calls.push({ method, url, at: new Date().toISOString() });
    return { status: 200, ok: true, body: '{"ok":true}' };
  }

  getCalls(): FakeRouterCall[] {
    return [...this.calls];
  }

  reset(): void {
    this.calls.length = 0;
  }
}
