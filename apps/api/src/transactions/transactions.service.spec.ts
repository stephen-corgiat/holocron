import { Repository } from 'typeorm';
import { TransactionsService } from './transactions.service';
import { TransactionEntity, TransactionKind } from './transaction.entity';

class FakeTxnRepo {
  rows: TransactionEntity[] = [];
  private nextId = 1;
  create(partial: Partial<TransactionEntity>): TransactionEntity {
    return { ...partial } as TransactionEntity;
  }
  async save(entity: TransactionEntity): Promise<TransactionEntity> {
    if (!entity.id) {
      entity.id = 'txn-' + this.nextId++;
      entity.createdAt = new Date();
      this.rows.push(entity);
    }
    return entity;
  }
  async find(opts: {
    where: {
      userId: string;
      kind?: TransactionKind;
      createdAt?: { _type?: string; _value?: unknown; _value1?: unknown; _value2?: unknown };
    };
    order?: { createdAt: 'ASC' | 'DESC' };
    take?: number;
  }): Promise<TransactionEntity[]> {
    let out = this.rows.filter((r) => r.userId === opts.where.userId);
    if (opts.where.kind) out = out.filter((r) => r.kind === opts.where.kind);
    if (opts.where.createdAt) {
      // TypeORM operator objects (Between / MoreThanOrEqual / LessThanOrEqual)
      // carry their values on private fields. We sniff them so the fake can
      // exercise the same code path as Postgres in the unit test.
      const op = opts.where.createdAt as unknown as {
        _type?: string;
        _value?: Date | Date[];
      };
      if (op._type === 'between' && Array.isArray(op._value)) {
        const [lo, hi] = op._value as Date[];
        out = out.filter((r) => r.createdAt >= lo && r.createdAt <= hi);
      } else if (op._type === 'moreThanOrEqual') {
        out = out.filter((r) => r.createdAt >= (op._value as Date));
      } else if (op._type === 'lessThanOrEqual') {
        out = out.filter((r) => r.createdAt <= (op._value as Date));
      }
    }
    if (opts.order?.createdAt === 'DESC') {
      out = [...out].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } else {
      out = [...out].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    }
    if (opts.take) out = out.slice(0, opts.take);
    return out;
  }
  createQueryBuilder() {
    const rows = this.rows;
    let userId: string | null = null;
    const qb = {
      select() {
        return qb;
      },
      where(_: string, params: { userId: string }) {
        userId = params.userId;
        return qb;
      },
      async getRawOne() {
        const sum = rows
          .filter((r) => r.userId === userId)
          .reduce((acc, r) => acc + r.amount, 0);
        return { sum };
      },
    };
    return qb;
  }
}

function makeService() {
  const repoFake = new FakeTxnRepo();
  const svc = new TransactionsService(
    repoFake as unknown as Repository<TransactionEntity>,
  );
  return { svc, repoFake };
}

describe('TransactionsService — append-only ledger', () => {
  it('append() persists a new row with the signed amount and metadata', async () => {
    const { svc, repoFake } = makeService();
    const txn = await svc.append({
      userId: 'u-bob',
      kind: 'earn',
      amount: 5,
      reason: 'Test Task',
      occurrenceId: 'o-1',
    });
    expect(txn.id).toBeDefined();
    expect(repoFake.rows).toHaveLength(1);
    expect(repoFake.rows[0]).toMatchObject({
      userId: 'u-bob',
      kind: 'earn',
      amount: 5,
      reason: 'Test Task',
      occurrenceId: 'o-1',
      adminUserId: null,
    });
  });

  it('append() is the only write path — no update method exists on the service', () => {
    const svc = new TransactionsService(
      undefined as unknown as Repository<TransactionEntity>,
    );
    expect((svc as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((svc as unknown as Record<string, unknown>).remove).toBeUndefined();
  });

  it('balanceFor() sums signed amounts across all kinds for the trackee', async () => {
    const { svc } = makeService();
    await svc.append({ userId: 'u-bob', kind: 'earn', amount: 10 });
    await svc.append({ userId: 'u-bob', kind: 'earn', amount: 7 });
    await svc.append({ userId: 'u-carol', kind: 'earn', amount: 99 });
    expect(await svc.balanceFor('u-bob')).toBe(17);
    expect(await svc.balanceFor('u-carol')).toBe(99);
    expect(await svc.balanceFor('u-nobody')).toBe(0);
  });

  it('historyFor() with a kind filter returns only matching rows', async () => {
    const { svc } = makeService();
    await svc.append({ userId: 'u-bob', kind: 'earn', amount: 3 });
    await svc.append({ userId: 'u-bob', kind: 'earn', amount: 4 });
    const earns = await svc.historyFor('u-bob', { kind: 'earn' });
    expect(earns).toHaveLength(2);
    expect(earns.every((t) => t.kind === 'earn')).toBe(true);
  });

  it('historyFor() narrows to the [from, to] window when both bounds are set', async () => {
    const { svc, repoFake } = makeService();
    await svc.append({ userId: 'u-bob', kind: 'earn', amount: 1 });
    repoFake.rows[0].createdAt = new Date('2026-05-10T10:00:00Z');
    await svc.append({ userId: 'u-bob', kind: 'earn', amount: 2 });
    repoFake.rows[1].createdAt = new Date('2026-05-12T10:00:00Z');
    await svc.append({ userId: 'u-bob', kind: 'earn', amount: 3 });
    repoFake.rows[2].createdAt = new Date('2026-05-15T10:00:00Z');

    const rows = await svc.historyFor('u-bob', {
      from: new Date('2026-05-11T00:00:00Z'),
      to: new Date('2026-05-14T00:00:00Z'),
    });
    expect(rows.map((r) => r.amount)).toEqual([2]);
  });

  it('historyFor() with only a from bound returns rows on or after that instant', async () => {
    const { svc, repoFake } = makeService();
    await svc.append({ userId: 'u-bob', kind: 'earn', amount: 1 });
    repoFake.rows[0].createdAt = new Date('2026-05-10T10:00:00Z');
    await svc.append({ userId: 'u-bob', kind: 'earn', amount: 2 });
    repoFake.rows[1].createdAt = new Date('2026-05-12T10:00:00Z');

    const rows = await svc.historyFor('u-bob', {
      from: new Date('2026-05-11T00:00:00Z'),
    });
    expect(rows.map((r) => r.amount)).toEqual([2]);
  });

  it('historyFor() returns rows newest-first', async () => {
    const { svc, repoFake } = makeService();
    await svc.append({ userId: 'u-bob', kind: 'earn', amount: 1 });
    // Force a deterministic createdAt gap.
    repoFake.rows[0].createdAt = new Date('2026-05-14T10:00:00Z');
    await svc.append({ userId: 'u-bob', kind: 'earn', amount: 2 });
    repoFake.rows[1].createdAt = new Date('2026-05-14T11:00:00Z');
    const history = await svc.historyFor('u-bob');
    expect(history.map((t) => t.amount)).toEqual([2, 1]);
  });
});
