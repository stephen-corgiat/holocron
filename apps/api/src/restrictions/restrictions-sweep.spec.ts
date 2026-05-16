import { Repository, DataSource } from 'typeorm';
import { RestrictionsService } from './restrictions.service';
import { RestrictionEntity } from './restriction.entity';
import { RestrictionCauseEntity } from './restriction-cause.entity';
import { RemediationRequestEntity } from './remediation-request.entity';
import { UserEntity } from '../users/user.entity';
import { RealtimeBus } from '../realtime/realtime-bus';
import { RestrictionEnforcementService } from './restriction-enforcement.service';
import { LiftService } from './lift';
import { ApplyLiftInput, LiftResult } from './lift/lift.types';

/**
 * `sweepExpired` is now a coordinator: it picks Restrictions whose
 * `effective_expires_at` has passed and delegates each lift to `LiftService`
 * with `mechanism: 'auto_expiry'`. These tests pin the *filtering* —
 * lift behavior itself is covered by `lift.service.spec.ts`.
 */
describe('RestrictionsService.sweepExpired', () => {
  let sweepNow: Date | null = null;

  function build() {
    const restrictions: RestrictionEntity[] = [];

    const restrictionsRepo = {
      find: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const cutoff = sweepNow!;
        return restrictions.filter((r) => {
          if ('liftedAt' in where && r.liftedAt !== null) return false;
          if ('effectiveExpiresAt' in where) {
            if (r.effectiveExpiresAt === null) return false;
            if (r.effectiveExpiresAt.getTime() > cutoff.getTime()) return false;
          }
          return true;
        });
      }),
    } as unknown as Repository<RestrictionEntity>;

    const dataSource = {
      transaction: async (fn: (m: unknown) => Promise<void>) => {
        await fn({ getRepository: () => null });
      },
    } as unknown as DataSource;

    const bus = new RealtimeBus();
    const enforcement = {
      activate: jest.fn(async () => undefined),
      deactivate: jest.fn(async () => undefined),
    } as unknown as RestrictionEnforcementService;

    const usersRepo = {
      findOne: jest.fn(async () => null),
    } as unknown as Repository<UserEntity>;
    const causesRepo = {
      find: jest.fn(async () => []),
    } as unknown as Repository<RestrictionCauseEntity>;
    const reqRepo = {
      update: jest.fn(async () => ({ affected: 0 })),
    } as unknown as Repository<RemediationRequestEntity>;

    const applyLift = jest.fn<Promise<LiftResult>, [ApplyLiftInput]>(
      async () => ({ touchedRestrictionIds: [], liftedRestrictionIds: [] }),
    );
    const lift = { applyLift } as unknown as LiftService;

    const svc = new RestrictionsService(
      dataSource,
      restrictionsRepo,
      causesRepo,
      reqRepo,
      usersRepo,
      bus,
      enforcement,
      lift,
      { now: () => new Date('2026-05-04T09:00:00.000Z') },
    );
    return { svc, restrictions, applyLift };
  }

  it('delegates a Restriction whose effective_expires_at has passed', async () => {
    const { svc, restrictions, applyLift } = build();
    restrictions.push({
      id: 'r-1',
      userId: 'u-bob',
      scope: 'internet',
      effectiveExpiresAt: new Date('2026-05-15T10:00:00Z'),
      effectiveRemediationGoals: [],
      liftedAt: null,
      createdAt: new Date(),
      causes: [],
    } as unknown as RestrictionEntity);

    sweepNow = new Date('2026-05-15T11:00:00Z');
    const lifted = await svc.sweepExpired(sweepNow);

    expect(lifted).toBe(1);
    expect(applyLift).toHaveBeenCalledTimes(1);
    expect(applyLift).toHaveBeenCalledWith({
      mechanism: 'auto_expiry',
      filter: { kind: 'all_for_restriction', restrictionId: 'r-1' },
    } as ApplyLiftInput);
  });

  it('skips Restrictions with effective_expires_at in the future', async () => {
    const { svc, restrictions, applyLift } = build();
    restrictions.push({
      id: 'r-1',
      userId: 'u-bob',
      scope: 'internet',
      effectiveExpiresAt: new Date('2026-05-15T20:00:00Z'),
      effectiveRemediationGoals: [],
      liftedAt: null,
      createdAt: new Date(),
      causes: [],
    } as unknown as RestrictionEntity);

    sweepNow = new Date('2026-05-15T11:00:00Z');
    const lifted = await svc.sweepExpired(sweepNow);

    expect(lifted).toBe(0);
    expect(applyLift).not.toHaveBeenCalled();
  });

  it('skips already-lifted Restrictions and admin-only (null expiry) ones', async () => {
    const { svc, restrictions, applyLift } = build();
    restrictions.push({
      id: 'r-lifted',
      userId: 'u-bob',
      scope: 'internet',
      effectiveExpiresAt: new Date('2020-01-01T00:00:00Z'),
      effectiveRemediationGoals: [],
      liftedAt: new Date(),
      createdAt: new Date(),
      causes: [],
    } as unknown as RestrictionEntity);
    restrictions.push({
      id: 'r-admin',
      userId: 'u-bob',
      scope: 'games',
      effectiveExpiresAt: null,
      effectiveRemediationGoals: [],
      liftedAt: null,
      createdAt: new Date(),
      causes: [],
    } as unknown as RestrictionEntity);

    sweepNow = new Date('2026-05-15T11:00:00Z');
    const lifted = await svc.sweepExpired(sweepNow);

    expect(lifted).toBe(0);
    expect(applyLift).not.toHaveBeenCalled();
  });

  it('continues sweeping when one lift throws', async () => {
    const { svc, restrictions, applyLift } = build();
    restrictions.push(
      {
        id: 'r-1',
        userId: 'u-bob',
        scope: 'internet',
        effectiveExpiresAt: new Date('2026-05-15T10:00:00Z'),
        effectiveRemediationGoals: [],
        liftedAt: null,
        createdAt: new Date(),
        causes: [],
      } as unknown as RestrictionEntity,
      {
        id: 'r-2',
        userId: 'u-bob',
        scope: 'games',
        effectiveExpiresAt: new Date('2026-05-15T10:00:00Z'),
        effectiveRemediationGoals: [],
        liftedAt: null,
        createdAt: new Date(),
        causes: [],
      } as unknown as RestrictionEntity,
    );
    applyLift
      .mockImplementationOnce(async () => {
        throw new Error('boom');
      })
      .mockImplementationOnce(async () => ({
        touchedRestrictionIds: ['r-2'],
        liftedRestrictionIds: ['r-2'],
      }));

    sweepNow = new Date('2026-05-15T11:00:00Z');
    const lifted = await svc.sweepExpired(sweepNow);
    expect(lifted).toBe(2);
    expect(applyLift).toHaveBeenCalledTimes(2);
  });
});
