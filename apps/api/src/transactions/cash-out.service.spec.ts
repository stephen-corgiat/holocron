import { Repository, DataSource, EntityManager } from 'typeorm';
import { CashOutService } from './cash-out.service';
import { CashOutRequestEntity } from './cash-out-request.entity';
import { TransactionEntity } from './transaction.entity';
import { TransactionsService } from './transactions.service';
import { RealtimeBus } from '../realtime/realtime-bus';
import { UserEntity } from '../users/user.entity';

interface FakeRow extends Record<string, unknown> {
  id?: string;
}

class FakeRepo<T extends FakeRow> {
  rows: T[] = [];
  private prefix: string;
  private nextId = 1;
  constructor(prefix: string) {
    this.prefix = prefix;
  }
  create(partial: Partial<T>): T {
    return { ...partial } as T;
  }
  async save(entity: T): Promise<T> {
    if (!entity.id) {
      entity.id = `${this.prefix}-${this.nextId++}`;
      if (!('createdAt' in entity))
        (entity as Record<string, unknown>).createdAt = new Date();
      this.rows.push(entity);
    } else {
      const idx = this.rows.findIndex((r) => r.id === entity.id);
      if (idx >= 0) this.rows[idx] = entity;
      else this.rows.push(entity);
    }
    return entity;
  }
  async findOne(opts: { where: Partial<T> }): Promise<T | null> {
    return (
      this.rows.find((r) =>
        Object.entries(opts.where).every(([k, v]) => (r as Record<string, unknown>)[k] === v),
      ) ?? null
    );
  }
  async find(opts: { where?: Partial<T>; order?: Record<string, 'ASC' | 'DESC'> } = {}): Promise<T[]> {
    const w = opts.where ?? {};
    return this.rows.filter((r) =>
      Object.entries(w).every(([k, v]) => (r as Record<string, unknown>)[k] === v),
    );
  }
}

class FakeTransactionsService {
  appended: Array<Parameters<TransactionsService['append']>[0]> = [];
  balance = 100;

  async append(
    input: Parameters<TransactionsService['append']>[0],
  ): Promise<TransactionEntity> {
    this.appended.push(input);
    const id = `txn-${this.appended.length}`;
    this.balance += input.amount;
    return {
      id,
      userId: input.userId,
      kind: input.kind,
      amount: input.amount,
      reason: input.reason ?? null,
      adminUserId: input.adminUserId ?? null,
      occurrenceId: input.occurrenceId ?? null,
      goalCompletionId: input.goalCompletionId ?? null,
      txnGroupId: null,
      createdAt: new Date(),
    } as unknown as TransactionEntity;
  }

  async balanceFor(_userId: string): Promise<number> {
    return this.balance;
  }
}

function build(opts: { balance?: number } = {}) {
  const usersRepo = new FakeRepo<UserEntity & FakeRow>('u');
  void usersRepo.save({ id: 'u-bob', displayName: 'Bob' } as unknown as UserEntity & FakeRow);
  const requestsRepo = new FakeRepo<CashOutRequestEntity & FakeRow>('co');
  const bus = new RealtimeBus();
  const txnEmit = jest.spyOn(bus, 'emit');
  const txns = new FakeTransactionsService();
  txns.balance = opts.balance ?? 100;

  const dataSource = {
    transaction: async (fn: (m: EntityManager) => Promise<void>) => {
      const fakeMgr = {
        getRepository: (entity: unknown) => {
          if (entity === CashOutRequestEntity) return requestsRepo;
          return requestsRepo;
        },
      } as unknown as EntityManager;
      await fn(fakeMgr);
    },
  } as unknown as DataSource;

  const svc = new CashOutService(
    dataSource,
    requestsRepo as unknown as Repository<CashOutRequestEntity>,
    usersRepo as unknown as Repository<UserEntity>,
    txns as unknown as TransactionsService,
    bus,
    { now: () => new Date('2026-05-04T09:00:00.000Z') },
  );
  return { svc, txns, requestsRepo, txnEmit };
}

describe('CashOutService.adminAdjust', () => {
  it('appends a signed adjustment with no side effects beyond the ledger', async () => {
    const { svc, txns, txnEmit } = build();
    const txn = await svc.adminAdjust('u-bob', -5, 'allowance reduction', 'u-alice');
    expect(txn.kind).toBe('adjustment');
    expect(txn.amount).toBe(-5);
    expect(txn.adminUserId).toBe('u-alice');
    expect(txn.reason).toBe('allowance reduction');
    expect(txns.appended).toHaveLength(1);
    expect(txnEmit).toHaveBeenCalledWith({ kind: 'transactions:changed', userId: 'u-bob' });
  });

  it('allows admin to adjust own balance', async () => {
    const { svc } = build();
    await svc.adminAdjust('u-bob', 7, null, 'u-bob');
    // (in real usage admin id would equal user id; test passes by not throwing)
  });

  it('rejects zero / non-integer amounts', async () => {
    const { svc } = build();
    await expect(svc.adminAdjust('u-bob', 0, null, 'u-alice')).rejects.toThrow();
    await expect(svc.adminAdjust('u-bob', 1.5, null, 'u-alice')).rejects.toThrow();
  });
});

describe('CashOutService.adminCashOut', () => {
  it('commits a negative withdrawal when balance covers', async () => {
    const { svc, txns } = build({ balance: 73 });
    const txn = await svc.adminCashOut('u-bob', 73, 'u-alice');
    expect(txn.kind).toBe('withdrawal');
    expect(txn.amount).toBe(-73);
    expect(txns.appended).toHaveLength(1);
  });

  it('blocks when balance < 0', async () => {
    const { svc } = build({ balance: -5 });
    await expect(svc.adminCashOut('u-bob', 1, 'u-alice')).rejects.toThrow(
      /negative/,
    );
  });

  it('rejects amounts that exceed current balance', async () => {
    const { svc } = build({ balance: 10 });
    await expect(svc.adminCashOut('u-bob', 50, 'u-alice')).rejects.toThrow(
      /exceeds/,
    );
  });
});

describe('CashOutService — tablet request flow', () => {
  it('createRequest queues a row with no ledger effect', async () => {
    const { svc, txns, requestsRepo } = build({ balance: 50 });
    const row = await svc.createRequest('u-bob', 30);
    expect(row.status).toBe('pending');
    expect(row.requestedAmount).toBe(30);
    expect(txns.appended).toHaveLength(0);
    expect(requestsRepo.rows).toHaveLength(1);
  });

  it('createRequest blocks when balance is negative', async () => {
    const { svc } = build({ balance: -1 });
    await expect(svc.createRequest('u-bob', 1)).rejects.toThrow(/negative/);
  });

  it('createRequest rejects amounts exceeding current balance', async () => {
    const { svc } = build({ balance: 10 });
    await expect(svc.createRequest('u-bob', 11)).rejects.toThrow(/exceeds/);
  });

  it('createRequest rejects a second request while one is pending', async () => {
    const { svc } = build({ balance: 50 });
    await svc.createRequest('u-bob', 10);
    await expect(svc.createRequest('u-bob', 5)).rejects.toThrow(/pending/);
  });

  it('hasPendingRequest reflects current pending state', async () => {
    const { svc } = build({ balance: 50 });
    expect(await svc.hasPendingRequest('u-bob')).toBe(false);
    const row = await svc.createRequest('u-bob', 10);
    expect(await svc.hasPendingRequest('u-bob')).toBe(true);
    await svc.rejectRequest(row.id!, 'u-alice');
    expect(await svc.hasPendingRequest('u-bob')).toBe(false);
  });

  it('commitRequest produces a withdrawal and transitions to committed', async () => {
    const { svc, txns, requestsRepo } = build({ balance: 50 });
    const row = await svc.createRequest('u-bob', 30);

    const txn = await svc.commitRequest(row.id!, 'u-alice');
    expect(txn.kind).toBe('withdrawal');
    expect(txn.amount).toBe(-30);
    const reloaded = requestsRepo.rows.find((r) => r.id === row.id)!;
    expect(reloaded.status).toBe('committed');
    expect(reloaded.committedTransactionId).toBe(txn.id);
    expect(reloaded.adminUserId).toBe('u-alice');
    expect(txns.appended).toHaveLength(1);
  });

  it('commitRequest re-validates balance against the latest state', async () => {
    const { svc, txns, requestsRepo } = build({ balance: 50 });
    const row = await svc.createRequest('u-bob', 30);
    // Simulate a concurrent change that drops the balance below the request.
    txns.balance = 10;
    await expect(svc.commitRequest(row.id!, 'u-alice')).rejects.toThrow(
      /exceeds/,
    );
    const reloaded = requestsRepo.rows.find((r) => r.id === row.id)!;
    expect(reloaded.status).toBe('pending');
  });

  it('rejectRequest transitions to rejected with no ledger effect', async () => {
    const { svc, txns, requestsRepo } = build({ balance: 50 });
    const row = await svc.createRequest('u-bob', 30);
    await svc.rejectRequest(row.id!, 'u-alice');
    const reloaded = requestsRepo.rows.find((r) => r.id === row.id)!;
    expect(reloaded.status).toBe('rejected');
    expect(reloaded.adminUserId).toBe('u-alice');
    expect(txns.appended).toHaveLength(0);
  });
});
