import { Injectable } from '@nestjs/common';
import {
  PiHoleHttpClient,
  PiHoleHttpResponse,
} from '../restrictions/pihole-enforcement';

export interface FakePiHoleCall {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  body: string | null;
  at: string;
}

interface FakeClient {
  client: string;
  comment: string | null;
  groups: number[];
}

/**
 * In-memory PiHole REST fake. Auto-auths, returns the two configured groups
 * by name, and stores per-MAC group membership. Calls are recorded so tests
 * can assert "did the suite issue a PUT for Bob's MAC?".
 */
@Injectable()
export class FakePiHoleHttpClient implements PiHoleHttpClient {
  private readonly calls: FakePiHoleCall[] = [];
  private readonly clientsByMac = new Map<string, FakeClient>();

  // PiHoleEnforcementService resolves group ids by name at startup. The
  // configured names from RestrictionsModule are looked up here.
  private readonly groups: Array<{ id: number; name: string }> = [
    { id: 1, name: 'blocked-games-dynamic' },
    { id: 2, name: 'blocked-streaming-dynamic' },
  ];

  async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    _headers: Record<string, string>,
    body?: string,
  ): Promise<PiHoleHttpResponse> {
    this.calls.push({
      method,
      url,
      body: body ?? null,
      at: new Date().toISOString(),
    });

    if (url.endsWith('/api/auth') && method === 'POST') {
      return ok({ session: { sid: 'FAKE_SID', valid: true } });
    }
    if (url.endsWith('/api/groups') && method === 'GET') {
      return ok({ groups: this.groups });
    }

    const clientMatch = /\/api\/clients\/([^/?#]+)$/.exec(url);
    if (clientMatch) {
      const mac = decodeURIComponent(clientMatch[1]);
      if (method === 'GET') {
        const record = this.clientsByMac.get(mac);
        if (!record) return notFound();
        return ok({ clients: [record] });
      }
      if (method === 'PUT') {
        const parsed = body ? (JSON.parse(body) as Partial<FakeClient>) : {};
        const existing = this.clientsByMac.get(mac);
        const next: FakeClient = {
          client: mac,
          comment: parsed.comment ?? existing?.comment ?? null,
          groups: parsed.groups ?? existing?.groups ?? [],
        };
        this.clientsByMac.set(mac, next);
        return ok({ client: next });
      }
    }

    return notFound();
  }

  getCalls(): FakePiHoleCall[] {
    return [...this.calls];
  }

  reset(): void {
    this.calls.length = 0;
    this.clientsByMac.clear();
  }
}

function ok(body: unknown): PiHoleHttpResponse {
  return { status: 200, ok: true, body: JSON.stringify(body) };
}

function notFound(): PiHoleHttpResponse {
  return { status: 404, ok: false, body: '{}' };
}
