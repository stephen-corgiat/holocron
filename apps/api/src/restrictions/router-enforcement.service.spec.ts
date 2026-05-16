import { Repository } from 'typeorm';
import { DeviceEntity } from '../users/device.entity';
import { EnforcementLogEntity } from './enforcement-log.entity';
import { RouterEnforcementService } from './router-enforcement.service';
import {
  RouterEnforcementConfig,
  RouterHttpClient,
  RouterHttpResponse,
} from './router-enforcement';

interface LogRow {
  restrictionId: string | null;
  userId: string;
  backend: 'router' | 'pihole';
  scope: string;
  action: 'add' | 'del';
  targetAddress: string | null;
  result: 'ok' | 'error' | 'skipped';
  httpStatus: number | null;
  error: string | null;
}

function makeRepos(devicesByUser: Record<string, Partial<DeviceEntity>[]>) {
  const log: LogRow[] = [];
  const devices = {
    find: jest.fn(async ({ where }: { where: { userId: string } }) => {
      return (devicesByUser[where.userId] ?? []).map((d) => ({
        id: 'dev-?',
        displayName: 'd',
        macAddress: null,
        createdAt: new Date(),
        ...d,
      })) as DeviceEntity[];
    }),
  } as unknown as Repository<DeviceEntity>;

  const enforcementLog = {
    find: jest.fn(),
    create: jest.fn((row: LogRow) => row),
    save: jest.fn(async (row: LogRow) => {
      log.push(row);
      return row;
    }),
  } as unknown as Repository<EnforcementLogEntity>;

  return { log, devices, enforcementLog };
}

function makeHttp(
  impl: (
    method: 'GET' | 'POST',
    url: string,
    headers: Record<string, string>,
  ) => Promise<RouterHttpResponse>,
): RouterHttpClient & { calls: Array<{ method: string; url: string }> } {
  const calls: Array<{ method: string; url: string }> = [];
  return {
    calls,
    async request(method, url, headers) {
      calls.push({ method, url });
      return impl(method, url, headers);
    },
  };
}

const CONFIG: RouterEnforcementConfig = {
  baseUrl: 'http://router.lan',
  bearerToken: 'secret-bearer',
};

describe('RouterEnforcementService', () => {
  describe('activate / deactivate (batched per Trackee)', () => {
    it('sends one POST /{scope}/add with comma-separated IPs and a bearer header', async () => {
      const repos = makeRepos({
        bob: [
          { userId: 'bob', ipAddress: '10.0.0.5' },
          { userId: 'bob', ipAddress: '10.0.0.6' },
        ],
      });
      const http = makeHttp(async (_m, _u, headers) => {
        expect(headers.Authorization).toBe('Bearer secret-bearer');
        return { ok: true, status: 200, body: '{}' };
      });
      const svc = new RouterEnforcementService(
        CONFIG,
        http,
        repos.devices,
        repos.enforcementLog,
      );
      await svc.activate('bob', 'games', 'r-1');
      expect(http.calls).toHaveLength(1);
      expect(http.calls[0].method).toBe('POST');
      expect(http.calls[0].url).toBe(
        'http://router.lan/games/add?ip=10.0.0.5%2C10.0.0.6',
      );
      expect(repos.log).toHaveLength(1);
      expect(repos.log[0]).toMatchObject({
        backend: 'router',
        action: 'add',
        targetAddress: '10.0.0.5,10.0.0.6',
        result: 'ok',
        httpStatus: 200,
      });
    });

    it('deactivate uses /{scope}/del', async () => {
      const repos = makeRepos({
        bob: [{ userId: 'bob', ipAddress: '10.0.0.5' }],
      });
      const http = makeHttp(async () => ({ ok: true, status: 200, body: '' }));
      const svc = new RouterEnforcementService(
        CONFIG,
        http,
        repos.devices,
        repos.enforcementLog,
      );
      await svc.deactivate('bob', 'internet', 'r-1');
      expect(http.calls[0].url).toBe(
        'http://router.lan/internet/del?ip=10.0.0.5',
      );
      expect(repos.log[0].action).toBe('del');
    });

    it('skips MAC-only devices when building the IP list', async () => {
      const repos = makeRepos({
        bob: [
          { userId: 'bob', ipAddress: '10.0.0.5' },
          { userId: 'bob', ipAddress: null, macAddress: 'aa:bb:cc:dd:ee:ff' },
          { userId: 'bob', ipAddress: '10.0.0.7' },
        ],
      });
      const http = makeHttp(async () => ({ ok: true, status: 200, body: '' }));
      const svc = new RouterEnforcementService(
        CONFIG,
        http,
        repos.devices,
        repos.enforcementLog,
      );
      await svc.activate('bob', 'internet', 'r-1');
      expect(http.calls).toHaveLength(1);
      expect(http.calls[0].url).toContain('ip=10.0.0.5%2C10.0.0.7');
    });

    it('writes a result=skipped log row (no HTTP call) when the Trackee has no IP-bearing devices', async () => {
      const repos = makeRepos({
        carol: [
          { userId: 'carol', ipAddress: null, macAddress: 'aa:bb:cc:dd:ee:ff' },
        ],
      });
      const http = makeHttp(async () => ({ ok: true, status: 200, body: '' }));
      const svc = new RouterEnforcementService(
        CONFIG,
        http,
        repos.devices,
        repos.enforcementLog,
      );
      await svc.activate('carol', 'games', 'r-1');
      expect(http.calls).toHaveLength(0);
      expect(repos.log).toHaveLength(1);
      expect(repos.log[0]).toMatchObject({
        backend: 'router',
        action: 'add',
        result: 'skipped',
        targetAddress: null,
      });
      expect(repos.log[0].error).toMatch(/no IP-bearing devices/);
    });

    it('logs error but does not throw when the router returns non-2xx', async () => {
      const repos = makeRepos({
        bob: [{ userId: 'bob', ipAddress: '10.0.0.5' }],
      });
      const http = makeHttp(async () => ({
        ok: false,
        status: 503,
        body: 'unavailable',
      }));
      const svc = new RouterEnforcementService(
        CONFIG,
        http,
        repos.devices,
        repos.enforcementLog,
      );
      await expect(
        svc.deactivate('bob', 'internet', 'r-1'),
      ).resolves.toBeUndefined();
      expect(repos.log).toHaveLength(1);
      expect(repos.log[0]).toMatchObject({
        action: 'del',
        result: 'error',
        httpStatus: 503,
        error: 'unavailable',
      });
    });

    it('logs error but does not throw when the HTTP client throws', async () => {
      const repos = makeRepos({
        bob: [{ userId: 'bob', ipAddress: '10.0.0.5' }],
      });
      const http = makeHttp(async () => {
        throw new Error('ECONNREFUSED');
      });
      const svc = new RouterEnforcementService(
        CONFIG,
        http,
        repos.devices,
        repos.enforcementLog,
      );
      await expect(
        svc.activate('bob', 'entertainment', 'r-1'),
      ).resolves.toBeUndefined();
      expect(repos.log).toHaveLength(1);
      expect(repos.log[0].result).toBe('error');
      expect(repos.log[0].httpStatus).toBeNull();
      expect(repos.log[0].error).toContain('ECONNREFUSED');
    });

    it('URL-encodes the IP list and trims whitespace per IP', async () => {
      const repos = makeRepos({
        bob: [
          { userId: 'bob', ipAddress: '  10.0.0.5  ' },
          { userId: 'bob', ipAddress: '10.0.0.6' },
        ],
      });
      const http = makeHttp(async () => ({ ok: true, status: 204, body: '' }));
      const svc = new RouterEnforcementService(
        CONFIG,
        http,
        repos.devices,
        repos.enforcementLog,
      );
      await svc.activate('bob', 'games', 'r-1');
      expect(http.calls[0].url).toBe(
        'http://router.lan/games/add?ip=10.0.0.5%2C10.0.0.6',
      );
    });
  });

  describe('status', () => {
    it('returns all_present from the new response shape', async () => {
      const repos = makeRepos({});
      const http = makeHttp(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({
          type: 'internet',
          all_present: true,
          devices: [{ ip: '10.0.0.5', present: true }],
          members: ['10.0.0.5'],
        }),
      }));
      const svc = new RouterEnforcementService(
        CONFIG,
        http,
        repos.devices,
        repos.enforcementLog,
      );
      await expect(svc.status('games', '10.0.0.5')).resolves.toBe(true);
      expect(http.calls[0].url).toBe(
        'http://router.lan/games/status?ip=10.0.0.5',
      );
    });

    it('falls back to per-device `present` when all_present is missing', async () => {
      const repos = makeRepos({});
      const http = makeHttp(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({
          devices: [{ ip: '10.0.0.5', present: false }],
        }),
      }));
      const svc = new RouterEnforcementService(
        CONFIG,
        http,
        repos.devices,
        repos.enforcementLog,
      );
      await expect(svc.status('games', '10.0.0.5')).resolves.toBe(false);
    });

    it('returns null on non-ok or parse failure', async () => {
      const repos = makeRepos({});
      const http = makeHttp(async () => ({
        ok: false,
        status: 500,
        body: 'oops',
      }));
      const svc = new RouterEnforcementService(
        CONFIG,
        http,
        repos.devices,
        repos.enforcementLog,
      );
      await expect(svc.status('games', '10.0.0.5')).resolves.toBeNull();
    });
  });
});
