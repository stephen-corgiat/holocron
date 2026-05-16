import { NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { RemediationRequestEntity } from '../remediation-request.entity';
import { RestrictionCauseEntity } from '../restriction-cause.entity';
import { RestrictionEnforcementService } from '../restriction-enforcement.service';
import { RestrictionEntity } from '../restriction.entity';
import { RealtimeBus } from '../../realtime/realtime-bus';
import { LiftService } from './lift.service';

interface World {
  restrictions: RestrictionEntity[];
  causes: RestrictionCauseEntity[];
  remediationRequests: RemediationRequestEntity[];
  deactivate: jest.Mock;
  emit: jest.SpyInstance;
  svc: LiftService;
}

function build(seed?: {
  restrictions?: Partial<RestrictionEntity>[];
  causes?: Partial<RestrictionCauseEntity>[];
  remediationRequests?: Partial<RemediationRequestEntity>[];
}): World {
  const restrictions: RestrictionEntity[] = (seed?.restrictions ?? []).map(
    (r) =>
      ({
        id: r.id,
        userId: r.userId,
        scope: r.scope,
        effectiveExpiresAt: r.effectiveExpiresAt ?? null,
        effectiveRemediationGoals: r.effectiveRemediationGoals ?? [],
        liftedAt: r.liftedAt ?? null,
        causes: [],
      }) as unknown as RestrictionEntity,
  );
  const causes: RestrictionCauseEntity[] = (seed?.causes ?? []).map(
    (c) =>
      ({
        id: c.id,
        restrictionId: c.restrictionId,
        kind: c.kind ?? 'miss',
        occurrenceId: c.occurrenceId ?? null,
        adminUserId: c.adminUserId ?? null,
        reason: c.reason ?? null,
        contributedExpiresAt: c.contributedExpiresAt ?? null,
        contributedRemediationGoals: c.contributedRemediationGoals ?? null,
        parentOnlyOnExpiry: c.parentOnlyOnExpiry ?? false,
        parentOnlyOnRemediation: c.parentOnlyOnRemediation ?? false,
        createdAt: new Date(),
      }) as unknown as RestrictionCauseEntity,
  );
  // Wire causes back onto their restriction for the relations: { causes: true } reload.
  for (const r of restrictions) {
    (r as { causes: RestrictionCauseEntity[] }).causes = causes.filter(
      (c) => c.restrictionId === r.id,
    );
  }
  const remediationRequests: RemediationRequestEntity[] = (
    seed?.remediationRequests ?? []
  ).map(
    (q) =>
      ({
        id: q.id,
        restrictionId: q.restrictionId,
        userId: q.userId,
        scope: q.scope,
        note: q.note ?? null,
        status: q.status ?? 'open',
        resolvedAt: q.resolvedAt ?? null,
        createdAt: new Date(),
      }) as unknown as RemediationRequestEntity,
  );

  const restrictionsRepo = {
    findOne: jest.fn(
      async ({ where }: { where: Record<string, unknown> }) => {
        const id = where.id as string;
        const r = restrictions.find((x) => x.id === id);
        if (!r) return null;
        if ('liftedAt' in where && r.liftedAt !== null) return null;
        // Refresh causes relation as the service expects.
        (r as { causes: RestrictionCauseEntity[] }).causes = causes.filter(
          (c) => c.restrictionId === r.id,
        );
        return r;
      },
    ),
    update: jest.fn(
      async (
        criteria: { id: string },
        patch: Partial<RestrictionEntity>,
      ) => {
        const r = restrictions.find((x) => x.id === criteria.id);
        if (r) Object.assign(r, patch);
        return { affected: r ? 1 : 0 };
      },
    ),
  } as unknown as Repository<RestrictionEntity>;

  const causesRepo = {
    find: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return causes.filter((c) => {
        if ('restrictionId' in where && c.restrictionId !== where.restrictionId) {
          return false;
        }
        if ('occurrenceId' in where && c.occurrenceId !== where.occurrenceId) {
          return false;
        }
        const idCriterion = where.id as { _type?: string; _value?: unknown } | string | undefined;
        if (idCriterion && typeof idCriterion === 'object' && '_value' in idCriterion) {
          const ids = idCriterion._value as string[];
          if (!ids.includes(c.id)) return false;
        }
        return true;
      });
    }),
    delete: jest.fn(async (ids: string[]) => {
      const idSet = new Set(ids);
      for (let i = causes.length - 1; i >= 0; i--) {
        if (idSet.has(causes[i].id)) causes.splice(i, 1);
      }
      return { affected: idSet.size };
    }),
  } as unknown as Repository<RestrictionCauseEntity>;

  const reqRepo = {
    update: jest.fn(
      async (
        criteria: { restrictionId: string; status?: string },
        patch: Partial<RemediationRequestEntity>,
      ) => {
        let affected = 0;
        for (const q of remediationRequests) {
          if (q.restrictionId !== criteria.restrictionId) continue;
          if (criteria.status && q.status !== criteria.status) continue;
          Object.assign(q, patch);
          affected++;
        }
        return { affected };
      },
    ),
  } as unknown as Repository<RemediationRequestEntity>;

  const fakeTrx = {
    getRepository: (entity: unknown) => {
      if (entity === RestrictionEntity) return restrictionsRepo;
      if (entity === RestrictionCauseEntity) return causesRepo;
      if (entity === RemediationRequestEntity) return reqRepo;
      return null;
    },
  };

  const dataSource = {
    transaction: async (fn: (m: unknown) => Promise<void>) => {
      await fn(fakeTrx);
    },
  } as unknown as DataSource;

  const bus = new RealtimeBus();
  const emit = jest.spyOn(bus, 'emit');
  const deactivate = jest.fn(async () => undefined);
  const enforcement = {
    deactivate,
    activate: jest.fn(async () => undefined),
  } as unknown as RestrictionEnforcementService;

  const svc = new LiftService(
    dataSource,
    restrictionsRepo,
    causesRepo,
    reqRepo,
    bus,
    enforcement,
    { now: () => new Date('2026-05-04T09:00:00.000Z') },
  );

  return { svc, restrictions, causes, remediationRequests, deactivate, emit };
}

describe('LiftService.applyLift — all_for_restriction', () => {
  it('lifts the Restriction and deactivates enforcement (admin mechanism)', async () => {
    const w = build({
      restrictions: [
        {
          id: 'r-1',
          userId: 'u-bob',
          scope: 'internet',
          effectiveExpiresAt: new Date('2026-05-10T00:00:00Z'),
          liftedAt: null,
        },
      ],
      causes: [
        { id: 'c-1', restrictionId: 'r-1', kind: 'miss' },
        { id: 'c-2', restrictionId: 'r-1', kind: 'admin' },
      ],
    });

    const result = await w.svc.applyLift({
      mechanism: 'admin',
      filter: { kind: 'all_for_restriction', restrictionId: 'r-1' },
    });

    expect(result.liftedRestrictionIds).toEqual(['r-1']);
    expect(w.restrictions[0].liftedAt).not.toBeNull();
    expect(w.restrictions[0].effectiveExpiresAt).toBeNull();
    expect(w.causes).toHaveLength(0);
    expect(w.deactivate).toHaveBeenCalledWith('u-bob', 'internet', 'r-1');
    expect(w.emit).toHaveBeenCalledWith({ kind: 'restrictions:changed', userId: 'u-bob' });
  });

  it('resolves open RemediationRequests on lift', async () => {
    const w = build({
      restrictions: [
        { id: 'r-1', userId: 'u-bob', scope: 'games', liftedAt: null },
      ],
      causes: [{ id: 'c-1', restrictionId: 'r-1', kind: 'miss' }],
      remediationRequests: [
        { id: 'q-1', restrictionId: 'r-1', userId: 'u-bob', scope: 'games', status: 'open' },
        { id: 'q-2', restrictionId: 'r-1', userId: 'u-bob', scope: 'games', status: 'resolved' },
      ],
    });

    await w.svc.applyLift({
      mechanism: 'auto_expiry',
      filter: { kind: 'all_for_restriction', restrictionId: 'r-1' },
    });

    expect(w.remediationRequests[0].status).toBe('resolved');
    expect(w.remediationRequests[0].resolvedAt).not.toBeNull();
    expect(w.remediationRequests[1].status).toBe('resolved'); // was already
  });

  it('throws NotFoundException when the Restriction does not exist', async () => {
    const w = build({});
    await expect(
      w.svc.applyLift({
        mechanism: 'admin',
        filter: { kind: 'all_for_restriction', restrictionId: 'r-missing' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException when the Restriction is already lifted', async () => {
    const w = build({
      restrictions: [
        {
          id: 'r-1',
          userId: 'u-bob',
          scope: 'internet',
          liftedAt: new Date('2026-05-01T00:00:00Z'),
        },
      ],
    });
    await expect(
      w.svc.applyLift({
        mechanism: 'admin',
        filter: { kind: 'all_for_restriction', restrictionId: 'r-1' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('LiftService.applyLift — by_occurrence', () => {
  it('removes only the matching MissCauses and lifts when the Restriction empties', async () => {
    const w = build({
      restrictions: [
        { id: 'r-1', userId: 'u-bob', scope: 'internet', liftedAt: null },
      ],
      causes: [
        {
          id: 'c-occ',
          restrictionId: 'r-1',
          kind: 'miss',
          occurrenceId: 'occ-late',
        },
      ],
    });

    const result = await w.svc.applyLift({
      mechanism: 'late_complete',
      filter: { kind: 'by_occurrence', occurrenceId: 'occ-late' },
    });

    expect(result.liftedRestrictionIds).toEqual(['r-1']);
    expect(w.restrictions[0].liftedAt).not.toBeNull();
    expect(w.deactivate).toHaveBeenCalledWith('u-bob', 'internet', 'r-1');
  });

  it('removes the matching Cause and keeps the Restriction active when others remain', async () => {
    const w = build({
      restrictions: [
        { id: 'r-1', userId: 'u-bob', scope: 'games', liftedAt: null },
      ],
      causes: [
        {
          id: 'c-late',
          restrictionId: 'r-1',
          kind: 'miss',
          occurrenceId: 'occ-late',
          contributedExpiresAt: new Date('2026-05-08T00:00:00Z'),
        },
        {
          id: 'c-other',
          restrictionId: 'r-1',
          kind: 'miss',
          occurrenceId: 'occ-other',
          contributedExpiresAt: new Date('2026-05-12T00:00:00Z'),
        },
      ],
    });

    const result = await w.svc.applyLift({
      mechanism: 'late_complete',
      filter: { kind: 'by_occurrence', occurrenceId: 'occ-late' },
    });

    expect(result.liftedRestrictionIds).toEqual([]);
    expect(result.touchedRestrictionIds).toEqual(['r-1']);
    expect(w.restrictions[0].liftedAt).toBeNull();
    // Effective expiry recomputed to the surviving cause's expiry.
    expect(w.restrictions[0].effectiveExpiresAt).toEqual(
      new Date('2026-05-12T00:00:00Z'),
    );
    expect(w.causes).toHaveLength(1);
    expect(w.causes[0].id).toBe('c-other');
    expect(w.deactivate).not.toHaveBeenCalled();
  });

  it('spans multiple Restrictions when a single Occurrence caused several scopes', async () => {
    const w = build({
      restrictions: [
        { id: 'r-int', userId: 'u-bob', scope: 'internet', liftedAt: null },
        { id: 'r-ent', userId: 'u-bob', scope: 'entertainment', liftedAt: null },
      ],
      causes: [
        { id: 'c-int', restrictionId: 'r-int', kind: 'miss', occurrenceId: 'occ-x' },
        { id: 'c-ent', restrictionId: 'r-ent', kind: 'miss', occurrenceId: 'occ-x' },
      ],
    });

    const result = await w.svc.applyLift({
      mechanism: 'late_complete',
      filter: { kind: 'by_occurrence', occurrenceId: 'occ-x' },
    });

    expect(new Set(result.liftedRestrictionIds)).toEqual(
      new Set(['r-int', 'r-ent']),
    );
    expect(w.deactivate).toHaveBeenCalledTimes(2);
  });

  it('no-ops silently when zero Causes match', async () => {
    const w = build({});
    const result = await w.svc.applyLift({
      mechanism: 'late_complete',
      filter: { kind: 'by_occurrence', occurrenceId: 'occ-nope' },
    });
    expect(result.touchedRestrictionIds).toEqual([]);
    expect(result.liftedRestrictionIds).toEqual([]);
    expect(w.deactivate).not.toHaveBeenCalled();
    expect(w.emit).not.toHaveBeenCalled();
  });
});

describe('LiftService.removeCauses (primitive)', () => {
  it('behaves identically to applyLift without recording a mechanism', async () => {
    const w = build({
      restrictions: [
        { id: 'r-1', userId: 'u-bob', scope: 'games', liftedAt: null },
      ],
      causes: [
        { id: 'c-1', restrictionId: 'r-1', kind: 'miss', occurrenceId: 'occ-1' },
      ],
    });

    const result = await w.svc.removeCauses({
      kind: 'by_occurrence',
      occurrenceId: 'occ-1',
    });

    expect(result.liftedRestrictionIds).toEqual(['r-1']);
    expect(w.restrictions[0].liftedAt).not.toBeNull();
  });
});
