import { Repository } from 'typeorm';
import { DeviceEntity } from '../users/device.entity';
import { EnforcementLogEntity } from './enforcement-log.entity';
import { PiHoleEnforcementService } from './pihole-enforcement.service';
import {
  PiHoleEnforcementConfig,
  PiHoleHttpClient,
  PiHoleHttpResponse,
} from './pihole-enforcement';

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

interface FakeClient {
  comment?: string | null;
  groups?: number[];
}

function makeRepos(devicesByUser: Record<string, Partial<DeviceEntity>[]>) {
  const log: LogRow[] = [];
  const devices = {
    find: jest.fn(async ({ where }: { where: { userId: string } }) => {
      return (devicesByUser[where.userId] ?? []).map((d) => ({
        id: 'dev-?',
        displayName: 'd',
        ipAddress: null,
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

interface Recorded {
  method: string;
  url: string;
  body?: string;
}

/**
 * Stitches together a fake PiHole that knows about:
 *  - a static set of groups (resolved at init),
 *  - a session id minted on POST /api/auth,
 *  - per-MAC client records that update on PUT and are returned on GET.
 */
function makePiHole(opts: {
  groups: Array<{ id: number; name: string }>;
  clients: Record<string, FakeClient>;
  /** If set, the first N PUTs return 401 (session expired). */
  expireFirstNPuts?: number;
  /** Bumped each /api/auth call so tests can assert re-auth. */
  authCount?: { n: number };
}): PiHoleHttpClient & { calls: Recorded[] } {
  const calls: Recorded[] = [];
  let sid = 'sid-1';
  let putsBeforeExpiry = opts.expireFirstNPuts ?? 0;
  const clients = { ...opts.clients };
  const authCount = opts.authCount ?? { n: 0 };

  return {
    calls,
    async request(method, url, headers, body): Promise<PiHoleHttpResponse> {
      calls.push({ method, url, body });

      if (url.endsWith('/api/auth') && method === 'POST') {
        authCount.n += 1;
        sid = `sid-${authCount.n}`;
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({ session: { sid, valid: true } }),
        };
      }

      // Every other call must carry the current sid.
      if (headers.sid !== sid) {
        return { ok: false, status: 401, body: 'unauthorized' };
      }

      if (url.endsWith('/api/groups') && method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({ groups: opts.groups }),
        };
      }

      const clientMatch = url.match(/\/api\/clients\/([^?]+)$/);
      if (clientMatch) {
        const mac = decodeURIComponent(clientMatch[1]);
        if (method === 'GET') {
          const c = clients[mac];
          if (!c) return { ok: false, status: 404, body: '' };
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({ clients: [c] }),
          };
        }
        if (method === 'PUT') {
          if (putsBeforeExpiry > 0) {
            putsBeforeExpiry -= 1;
            return { ok: false, status: 401, body: 'session expired' };
          }
          const parsed = body ? (JSON.parse(body) as FakeClient) : {};
          clients[mac] = {
            comment: parsed.comment ?? null,
            groups: parsed.groups ?? [],
          };
          return { ok: true, status: 200, body: '{}' };
        }
      }

      return { ok: false, status: 404, body: 'unknown' };
    },
  };
}

const BASE_CONFIG: PiHoleEnforcementConfig = {
  baseUrl: 'http://pi.hole',
  apiPassword: 'secret',
  groupNamesByScope: {
    games: 'blocked-games-dynamic',
    entertainment: 'blocked-streaming-dynamic',
  },
};

async function makeReadyService(
  http: PiHoleHttpClient,
  repos: ReturnType<typeof makeRepos>,
  config: PiHoleEnforcementConfig = BASE_CONFIG,
): Promise<PiHoleEnforcementService> {
  const svc = new PiHoleEnforcementService(
    config,
    http,
    repos.devices,
    repos.enforcementLog,
  );
  await svc.onModuleInit();
  return svc;
}

describe('PiHoleEnforcementService', () => {
  describe('group resolution at init', () => {
    it('authenticates then maps both configured group names to numeric ids', async () => {
      const repos = makeRepos({});
      const authCount = { n: 0 };
      const http = makePiHole({
        groups: [
          { id: 0, name: 'Default' },
          { id: 1, name: 'blocked-games-dynamic' },
          { id: 2, name: 'blocked-streaming-dynamic' },
        ],
        clients: {},
        authCount,
      });
      await makeReadyService(http, repos);
      expect(authCount.n).toBe(1);
      const groupsCall = http.calls.find((c) => c.url.endsWith('/api/groups'));
      expect(groupsCall).toBeDefined();
    });

    it('throws at init when a configured group name is missing', async () => {
      const repos = makeRepos({});
      const http = makePiHole({
        groups: [{ id: 0, name: 'Default' }],
        clients: {},
      });
      const svc = new PiHoleEnforcementService(
        BASE_CONFIG,
        http,
        repos.devices,
        repos.enforcementLog,
      );
      await expect(svc.onModuleInit()).rejects.toThrow(
        /blocked-games-dynamic/,
      );
    });
  });

  describe('activate (add group to client)', () => {
    it('GETs the client, PUTs back with the group id added, logs ok per MAC', async () => {
      const repos = makeRepos({
        bob: [
          { userId: 'bob', macAddress: 'aa:bb:cc:dd:ee:ff' },
          { userId: 'bob', macAddress: '11:22:33:44:55:66' },
        ],
      });
      const http = makePiHole({
        groups: [
          { id: 1, name: 'blocked-games-dynamic' },
          { id: 2, name: 'blocked-streaming-dynamic' },
        ],
        clients: {
          'aa:bb:cc:dd:ee:ff': { comment: 'Bob laptop', groups: [0] },
          '11:22:33:44:55:66': { comment: null, groups: [] },
        },
      });
      const svc = await makeReadyService(http, repos);
      await svc.activate('bob', 'games', 'r-1');

      const puts = http.calls.filter((c) => c.method === 'PUT');
      expect(puts).toHaveLength(2);
      expect(JSON.parse(puts[0].body!)).toEqual({
        comment: 'Bob laptop',
        groups: [0, 1],
      });
      expect(JSON.parse(puts[1].body!)).toEqual({
        comment: null,
        groups: [1],
      });
      expect(repos.log).toHaveLength(2);
      expect(repos.log.every((r) => r.backend === 'pihole')).toBe(true);
      expect(repos.log.every((r) => r.action === 'add')).toBe(true);
      expect(repos.log.every((r) => r.scope === 'games')).toBe(true);
      expect(repos.log.map((r) => r.targetAddress).sort()).toEqual(
        ['11:22:33:44:55:66', 'aa:bb:cc:dd:ee:ff'].sort(),
      );
    });

    it('skips the PUT when the group is already present (idempotent)', async () => {
      const repos = makeRepos({
        bob: [{ userId: 'bob', macAddress: 'aa:bb:cc:dd:ee:ff' }],
      });
      const http = makePiHole({
        groups: [{ id: 1, name: 'blocked-games-dynamic' }, { id: 2, name: 'blocked-streaming-dynamic' }],
        clients: {
          'aa:bb:cc:dd:ee:ff': { comment: null, groups: [0, 1] },
        },
      });
      const svc = await makeReadyService(http, repos);
      await svc.activate('bob', 'games', 'r-1');
      const puts = http.calls.filter((c) => c.method === 'PUT');
      expect(puts).toHaveLength(0);
      expect(repos.log[0]).toMatchObject({ result: 'ok', httpStatus: null });
    });

    it('writes a result=skipped row when the Trackee has no MAC-bearing devices', async () => {
      const repos = makeRepos({
        carol: [{ userId: 'carol', macAddress: null, ipAddress: '10.0.0.5' }],
      });
      const http = makePiHole({
        groups: [{ id: 1, name: 'blocked-games-dynamic' }, { id: 2, name: 'blocked-streaming-dynamic' }],
        clients: {},
      });
      const svc = await makeReadyService(http, repos);
      await svc.activate('carol', 'games', 'r-1');
      expect(http.calls.some((c) => c.method === 'PUT')).toBe(false);
      expect(repos.log).toHaveLength(1);
      expect(repos.log[0]).toMatchObject({
        backend: 'pihole',
        action: 'add',
        result: 'skipped',
        targetAddress: null,
      });
      expect(repos.log[0].error).toMatch(/no MAC-bearing devices/);
    });
  });

  describe('deactivate (remove group from client)', () => {
    it('PUTs the client without the scope group when it was present', async () => {
      const repos = makeRepos({
        bob: [{ userId: 'bob', macAddress: 'aa:bb:cc:dd:ee:ff' }],
      });
      const http = makePiHole({
        groups: [
          { id: 1, name: 'blocked-games-dynamic' },
          { id: 2, name: 'blocked-streaming-dynamic' },
        ],
        clients: {
          'aa:bb:cc:dd:ee:ff': { comment: 'Bob', groups: [0, 2] },
        },
      });
      const svc = await makeReadyService(http, repos);
      await svc.deactivate('bob', 'entertainment', 'r-1');
      const puts = http.calls.filter((c) => c.method === 'PUT');
      expect(puts).toHaveLength(1);
      expect(JSON.parse(puts[0].body!)).toEqual({
        comment: 'Bob',
        groups: [0],
      });
      expect(repos.log[0]).toMatchObject({ action: 'del', result: 'ok' });
    });

    it('is a no-op (and an ok log row) when the group is already absent', async () => {
      const repos = makeRepos({
        bob: [{ userId: 'bob', macAddress: 'aa:bb:cc:dd:ee:ff' }],
      });
      const http = makePiHole({
        groups: [
          { id: 1, name: 'blocked-games-dynamic' },
          { id: 2, name: 'blocked-streaming-dynamic' },
        ],
        clients: {
          'aa:bb:cc:dd:ee:ff': { comment: null, groups: [0] },
        },
      });
      const svc = await makeReadyService(http, repos);
      await svc.deactivate('bob', 'games', 'r-1');
      expect(http.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
      expect(repos.log[0]).toMatchObject({ result: 'ok', httpStatus: null });
    });
  });

  describe('session', () => {
    it('re-authenticates and retries when a PUT returns 401', async () => {
      const repos = makeRepos({
        bob: [{ userId: 'bob', macAddress: 'aa:bb:cc:dd:ee:ff' }],
      });
      const authCount = { n: 0 };
      const http = makePiHole({
        groups: [
          { id: 1, name: 'blocked-games-dynamic' },
          { id: 2, name: 'blocked-streaming-dynamic' },
        ],
        clients: {
          'aa:bb:cc:dd:ee:ff': { comment: null, groups: [] },
        },
        expireFirstNPuts: 1,
        authCount,
      });
      const svc = await makeReadyService(http, repos);
      const authsAfterInit = authCount.n;
      await svc.activate('bob', 'games', 'r-1');
      expect(authCount.n).toBeGreaterThan(authsAfterInit);
      expect(repos.log[0]).toMatchObject({ result: 'ok' });
    });
  });
});
