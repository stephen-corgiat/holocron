import { Repository } from 'typeorm';
import { EnforcementLogEntity } from './enforcement-log.entity';
import { RestrictionEnforcementService } from './restriction-enforcement.service';
import { RestrictionBackend } from './restriction-backend';
import { RestrictionScope } from './restriction-merge';

interface Recorded {
  method: 'activate' | 'deactivate';
  userId: string;
  scope: RestrictionScope;
  restrictionId: string | null;
}

function makeBackend(label: string): RestrictionBackend & {
  calls: Recorded[];
  label: string;
} {
  const calls: Recorded[] = [];
  return {
    label,
    calls,
    async activate(userId, scope, restrictionId) {
      calls.push({ method: 'activate', userId, scope, restrictionId });
    },
    async deactivate(userId, scope, restrictionId) {
      calls.push({ method: 'deactivate', userId, scope, restrictionId });
    },
  };
}

function makeLogRepo() {
  const find = jest.fn(async () => [] as EnforcementLogEntity[]);
  return {
    repo: { find } as unknown as Repository<EnforcementLogEntity>,
    find,
  };
}

describe('RestrictionEnforcementService dispatcher', () => {
  it('routes internet to router and games/entertainment to pihole', async () => {
    const router = makeBackend('router');
    const pihole = makeBackend('pihole');
    const { repo } = makeLogRepo();
    const svc = new RestrictionEnforcementService(router, pihole, repo);

    await svc.activate('bob', 'internet', 'r-1');
    await svc.activate('bob', 'games', 'r-2');
    await svc.activate('bob', 'entertainment', 'r-3');
    await svc.deactivate('bob', 'internet', 'r-1');
    await svc.deactivate('bob', 'games', null);

    expect(router.calls).toEqual([
      { method: 'activate', userId: 'bob', scope: 'internet', restrictionId: 'r-1' },
      {
        method: 'deactivate',
        userId: 'bob',
        scope: 'internet',
        restrictionId: 'r-1',
      },
    ]);
    expect(pihole.calls).toEqual([
      { method: 'activate', userId: 'bob', scope: 'games', restrictionId: 'r-2' },
      {
        method: 'activate',
        userId: 'bob',
        scope: 'entertainment',
        restrictionId: 'r-3',
      },
      {
        method: 'deactivate',
        userId: 'bob',
        scope: 'games',
        restrictionId: null,
      },
    ]);
  });

  it('queries the unified enforcement_log via recentLog', async () => {
    const router = makeBackend('router');
    const pihole = makeBackend('pihole');
    const { repo, find } = makeLogRepo();
    const svc = new RestrictionEnforcementService(router, pihole, repo);
    await svc.recentLog(25);
    expect(find).toHaveBeenCalledWith({
      order: { createdAt: 'DESC' },
      take: 25,
    });
  });
});
