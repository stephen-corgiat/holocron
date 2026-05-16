import { Repository } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { UserEntity } from './user.entity';
import { RealtimeBus } from '../realtime/realtime-bus';

class FakeRepository {
  private rows: UserEntity[] = [];
  private nextId = 1;

  create(partial: Partial<UserEntity>): UserEntity {
    return { ...partial } as UserEntity;
  }

  async save(entity: UserEntity): Promise<UserEntity> {
    if (!entity.id) {
      entity.id = `00000000-0000-0000-0000-${String(this.nextId++).padStart(12, '0')}`;
      entity.createdAt = entity.createdAt ?? new Date(Date.now() + this.rows.length);
      this.rows.push(entity);
    } else {
      const idx = this.rows.findIndex((r) => r.id === entity.id);
      if (idx >= 0) this.rows[idx] = entity;
      else this.rows.push(entity);
    }
    return entity;
  }

  async findOne(opts: { where: Partial<UserEntity> }): Promise<UserEntity | null> {
    const where = opts.where as Record<string, unknown>;
    return (
      this.rows.find((r) =>
        Object.entries(where).every(
          ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
        ),
      ) ?? null
    );
  }

  async find(
    opts: {
      where?: Partial<UserEntity> & { deactivatedAt?: unknown };
      order?: Record<string, 'ASC' | 'DESC'>;
    } = {},
  ): Promise<UserEntity[]> {
    let out = [...this.rows];
    if (opts.where) {
      const w = opts.where as Record<string, unknown>;
      out = out.filter((r) =>
        Object.entries(w).every(([k, v]) => {
          // Crude IsNull() detection: matched objects that are not Date.
          if (v && typeof v === 'object' && !(v instanceof Date)) {
            return (r as unknown as Record<string, unknown>)[k] === null;
          }
          return (r as unknown as Record<string, unknown>)[k] === v;
        }),
      );
    }
    if (opts.order) {
      const entries = Object.entries(opts.order);
      out.sort((a, b) => {
        for (const [k, dir] of entries) {
          const av = (a as unknown as Record<string, unknown>)[k];
          const bv = (b as unknown as Record<string, unknown>)[k];
          if (av === bv) continue;
          if (av === null || av === undefined) return dir === 'ASC' ? -1 : 1;
          if (bv === null || bv === undefined) return dir === 'ASC' ? 1 : -1;
          return (av < bv ? -1 : 1) * (dir === 'ASC' ? 1 : -1);
        }
        return 0;
      });
    }
    return out;
  }

  async count(opts: { where: Partial<UserEntity> & { deactivatedAt?: unknown } }): Promise<number> {
    return (await this.find(opts)).length;
  }
}

function makeService(): {
  svc: UsersService;
  bus: RealtimeBus;
  streaksRepo: FakeRepository;
} {
  const repo = new FakeRepository() as unknown as Repository<UserEntity>;
  const bus = new RealtimeBus();
  const presence = {
    ensureDefault: jest.fn().mockResolvedValue(undefined),
  } as unknown as import('../presence/presence.service').PresenceService;
  const streaksRepo = new FakeRepository();
  const streaks = streaksRepo as unknown as Repository<
    import('../tasks/daily-streak.entity').DailyStreakEntity
  >;
  const svc = new UsersService(repo, streaks, bus, presence);
  return { svc, bus, streaksRepo };
}

describe('UsersService — Trackee CRUD', () => {
  describe('createUser', () => {
    it('auto-derives router_id from display_name when not provided', async () => {
      const { svc } = makeService();
      const u = await svc.createUser({
        displayName: 'Bob Reyes',
        isAdmin: false,
        isRestrictable: true,
      });
      expect(u.routerId).toBe('bob-reyes');
    });

    it('treats an explicit empty router_id as "skip router enforcement"', async () => {
      const { svc } = makeService();
      const u = await svc.createUser({
        displayName: 'Sarah',
        isAdmin: true,
        isRestrictable: false,
        routerId: '',
        password: 'correct-horse',
      });
      expect(u.routerId).toBe('');
    });

    it('does NOT add a uniqueness suffix even when two Trackees share a slug', async () => {
      const { svc } = makeService();
      const a = await svc.createUser({
        displayName: 'Bob',
        isAdmin: false,
        isRestrictable: true,
      });
      const b = await svc.createUser({
        displayName: 'Bob',
        isAdmin: false,
        isRestrictable: true,
      });
      expect(a.routerId).toBe('bob');
      expect(b.routerId).toBe('bob');
    });

    it('treats is_admin and is_restrictable as independent flags (matrix)', async () => {
      const { svc } = makeService();
      const matrix = [
        { isAdmin: false, isRestrictable: false, name: 'Neutral' },
        { isAdmin: false, isRestrictable: true, name: 'Kid' },
        { isAdmin: true, isRestrictable: false, name: 'Parent', password: 'pw-parent' },
        // The unusual case the schema must allow: an admin who is also restrictable.
        { isAdmin: true, isRestrictable: true, name: 'AdminKid', password: 'pw-akid' },
      ];
      for (const row of matrix) {
        const u = await svc.createUser({
          displayName: row.name,
          isAdmin: row.isAdmin,
          isRestrictable: row.isRestrictable,
          password: row.password,
        });
        expect(u.isAdmin).toBe(row.isAdmin);
        expect(u.isRestrictable).toBe(row.isRestrictable);
      }
    });

    it('rejects admin creation without a password', async () => {
      const { svc } = makeService();
      await expect(
        svc.createUser({
          displayName: 'NoPassword',
          isAdmin: true,
          isRestrictable: false,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('emits a roster-changed event on create', async () => {
      const { svc, bus } = makeService();
      const fired: number[] = [];
      bus.asObservable().subscribe((e) => {
        if (e.kind === 'users:roster_changed') fired.push(Date.now());
      });
      await svc.createUser({
        displayName: 'Carol',
        isAdmin: false,
        isRestrictable: true,
      });
      expect(fired).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('lets the admin edit router_id (including to empty)', async () => {
      const { svc } = makeService();
      const created = await svc.createUser({
        displayName: 'Carol',
        isAdmin: false,
        isRestrictable: true,
      });
      const updated = await svc.update(created.id, { routerId: '' });
      expect(updated.routerId).toBe('');
    });

    it('throws NotFoundException when the Trackee does not exist', async () => {
      const { svc } = makeService();
      await expect(
        svc.update('00000000-0000-0000-0000-000000000999', {
          displayName: 'Ghost',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to promote a Trackee to admin without a password', async () => {
      const { svc } = makeService();
      const kid = await svc.createUser({
        displayName: 'Bob',
        isAdmin: false,
        isRestrictable: true,
      });
      await expect(
        svc.update(kid.id, { isAdmin: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('changes an admin username, normalizing case and whitespace', async () => {
      const { svc } = makeService();
      const alice = await svc.createUser({
        displayName: 'Alice',
        isAdmin: true,
        isRestrictable: false,
        password: 'correct-horse',
        username: 'alice',
      });
      const updated = await svc.update(alice.id, { username: '  ALICE2 ' });
      expect(updated.username).toBe('alice2');
      // The old username no longer resolves; the new one does.
      expect(await svc.findByUsername('alice')).toBeNull();
      expect((await svc.findByUsername('alice2'))?.id).toBe(alice.id);
    });

    it('refuses to clear an admin username', async () => {
      const { svc } = makeService();
      const alice = await svc.createUser({
        displayName: 'Alice',
        isAdmin: true,
        isRestrictable: false,
        password: 'correct-horse',
        username: 'alice',
      });
      await expect(
        svc.update(alice.id, { username: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a username that collides with another Trackee', async () => {
      const { svc } = makeService();
      await svc.createUser({
        displayName: 'Alice',
        isAdmin: true,
        isRestrictable: false,
        password: 'correct-horse',
        username: 'alice',
      });
      const bob = await svc.createUser({
        displayName: 'Bob',
        isAdmin: true,
        isRestrictable: false,
        password: 'battery-staple',
        username: 'bob',
      });
      await expect(
        svc.update(bob.id, { username: 'alice' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lets an admin keep its own username unchanged on an unrelated edit', async () => {
      const { svc } = makeService();
      const alice = await svc.createUser({
        displayName: 'Alice',
        isAdmin: true,
        isRestrictable: false,
        password: 'correct-horse',
        username: 'alice',
      });
      // Re-sending the same username must not trip the duplicate guard.
      const updated = await svc.update(alice.id, {
        username: 'alice',
        color: '#abcdef',
      });
      expect(updated.username).toBe('alice');
      expect(updated.color).toBe('#abcdef');
    });

    it('changes a Trackee password (old hash stops verifying, new one verifies)', async () => {
      const { svc } = makeService();
      const alice = await svc.createUser({
        displayName: 'Alice',
        isAdmin: true,
        isRestrictable: false,
        password: 'correct-horse',
        username: 'alice',
      });
      const updated = await svc.update(alice.id, { password: 'battery-staple' });
      expect(await svc.verifyPassword(updated, 'battery-staple')).toBe(true);
      expect(await svc.verifyPassword(updated, 'correct-horse')).toBe(false);
    });
  });

  describe('deactivate', () => {
    it('marks the Trackee deactivated and removes them from the roster', async () => {
      const { svc } = makeService();
      const a = await svc.createUser({
        displayName: 'Bob',
        isAdmin: false,
        isRestrictable: true,
      });
      const b = await svc.createUser({
        displayName: 'Carol',
        isAdmin: false,
        isRestrictable: true,
      });
      await svc.deactivate(a.id);

      const roster = await svc.roster();
      expect(roster.map((u) => u.id)).toEqual([b.id]);

      const all = await svc.list();
      expect(all.map((u) => u.id)).toContain(a.id);
    });
  });

  describe('roster ordering', () => {
    it('returns kids first (is_admin=false), then admins, in creation order', async () => {
      const { svc } = makeService();
      const sarah = await svc.createUser({
        displayName: 'Sarah',
        isAdmin: true,
        isRestrictable: false,
        password: 'pw-sarah',
      });
      const bob = await svc.createUser({
        displayName: 'Bob',
        isAdmin: false,
        isRestrictable: true,
      });
      const tom = await svc.createUser({
        displayName: 'Tom',
        isAdmin: true,
        isRestrictable: false,
        password: 'pw-tom',
      });
      const carol = await svc.createUser({
        displayName: 'Carol',
        isAdmin: false,
        isRestrictable: true,
      });

      const roster = await svc.roster();
      expect(roster.map((u) => u.displayName)).toEqual([
        'Bob',
        'Carol',
        'Sarah',
        'Tom',
      ]);
      // Sanity: every Trackee is included.
      expect(roster).toHaveLength(4);
      expect(roster[0].id).toBe(bob.id);
      expect(roster[3].id).toBe(tom.id);
    });
  });

  describe('streakMap', () => {
    it('returns a userId → count map from the DailyStreak repo', async () => {
      const { svc, streaksRepo } = makeService();
      // Seed the streak repo directly — streak rows are written by the
      // DailyStreakService rollover, not by UsersService.
      const streakSave = streaksRepo.save.bind(streaksRepo) as unknown as (
        e: Record<string, unknown>,
      ) => Promise<unknown>;
      await streakSave({
        id: 'streak-1',
        userId: 'u-bob',
        count: 6,
        lastQualifyingDay: '2026-05-15',
      });
      await streakSave({
        id: 'streak-2',
        userId: 'u-carol',
        count: 0,
        lastQualifyingDay: null,
      });

      const map = await svc.streakMap();
      expect(map.size).toBe(2);
      expect(map.get('u-bob')).toBe(6);
      expect(map.get('u-carol')).toBe(0);
      expect(map.get('u-missing')).toBeUndefined();
    });
  });
});
