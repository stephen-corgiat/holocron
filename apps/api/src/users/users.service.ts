import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { UserEntity } from './user.entity';
import { slugifyDisplayName } from './slug';
import { RealtimeBus } from '../realtime/realtime-bus';
import { PresenceService } from '../presence/presence.service';
import { DailyStreakEntity } from '../tasks/daily-streak.entity';

const BCRYPT_COST = 10;

export interface CreateTrackeeInput {
  displayName: string;
  isAdmin: boolean;
  isRestrictable?: boolean;
  routerId?: string | null;
  avatar?: string | null;
  color?: string | null;
  password?: string;
  username?: string;
}

export interface UpdateTrackeeInput {
  displayName?: string;
  isAdmin?: boolean;
  isRestrictable?: boolean;
  routerId?: string | null;
  avatar?: string | null;
  color?: string | null;
  password?: string;
  username?: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(DailyStreakEntity)
    private readonly streaks: Repository<DailyStreakEntity>,
    private readonly bus: RealtimeBus,
    @Inject(forwardRef(() => PresenceService))
    private readonly presence: PresenceService,
  ) {}

  /**
   * Map of `user_id` → current daily-routine streak count for every active
   * Trackee. Bound to the roster surface so the tablet header pill and ring
   * bonus tease have the number without a second round trip.
   */
  async streakMap(): Promise<Map<string, number>> {
    const rows = await this.streaks.find();
    const out = new Map<string, number>();
    for (const r of rows) out.set(r.userId, r.count);
    return out;
  }

  findByUsername(username: string): Promise<UserEntity | null> {
    return this.users.findOne({ where: { username: username.toLowerCase() } });
  }

  findById(id: string): Promise<UserEntity | null> {
    return this.users.findOne({ where: { id } });
  }

  countAdmins(): Promise<number> {
    return this.users.count({
      where: { isAdmin: true, deactivatedAt: IsNull() },
    });
  }

  /** Full list including deactivated — admin-facing. */
  list(): Promise<UserEntity[]> {
    return this.users.find({ order: { createdAt: 'ASC' } });
  }

  /**
   * Active Trackees ordered for the tablet's tab strip: kids first
   * (`is_admin = false`), then admins, with creation order breaking ties.
   */
  roster(): Promise<UserEntity[]> {
    return this.users.find({
      where: { deactivatedAt: IsNull() },
      order: { isAdmin: 'ASC', createdAt: 'ASC' },
    });
  }

  async createUser(input: CreateTrackeeInput): Promise<UserEntity> {
    if (input.isAdmin && !input.password) {
      throw new BadRequestException('admin Trackees require a password');
    }

    // router_id auto-derives from display_name unless explicitly provided.
    // An empty string is a valid value — it skips router enforcement for
    // this Trackee. Treat undefined as "auto-derive."
    const routerId =
      input.routerId === undefined
        ? slugifyDisplayName(input.displayName)
        : input.routerId;

    // Username: required for admins (browser login), optional otherwise.
    let username: string | null = null;
    if (input.isAdmin) {
      const desired = (input.username ?? slugifyDisplayName(input.displayName))
        .toLowerCase()
        .trim();
      if (!desired) {
        throw new BadRequestException(
          'admin Trackees require a username (display_name produced an empty slug)',
        );
      }
      username = desired;
    } else if (input.username) {
      username = input.username.toLowerCase().trim() || null;
    }

    const passwordHash = input.password
      ? await bcrypt.hash(input.password, BCRYPT_COST)
      : null;

    const entity = this.users.create({
      username,
      displayName: input.displayName,
      passwordHash,
      isAdmin: input.isAdmin,
      isRestrictable: input.isRestrictable ?? false,
      routerId,
      avatar: input.avatar ?? null,
      color: input.color ?? null,
      deactivatedAt: null,
    });
    const saved = await this.users.save(entity);
    // Materialize the default presence schedule: `none` for admins,
    // `full_time` for non-admin Restrictable Trackees. Idempotent.
    await this.presence.ensureDefault(saved);
    this.bus.emit({ kind: 'users:roster_changed' });
    return saved;
  }

  async update(id: string, patch: UpdateTrackeeInput): Promise<UserEntity> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`Trackee ${id} not found`);

    if (patch.displayName !== undefined) user.displayName = patch.displayName;
    if (patch.isAdmin !== undefined) user.isAdmin = patch.isAdmin;
    if (patch.isRestrictable !== undefined)
      user.isRestrictable = patch.isRestrictable;
    if (patch.routerId !== undefined) user.routerId = patch.routerId;
    if (patch.avatar !== undefined) user.avatar = patch.avatar;
    if (patch.color !== undefined) user.color = patch.color;
    if (patch.username !== undefined) {
      // Normalize the same way create does; an empty/whitespace-only value
      // clears the username (only valid for non-admins, guarded below).
      user.username = patch.username.toLowerCase().trim() || null;
    }
    if (patch.password) {
      user.passwordHash = await bcrypt.hash(patch.password, BCRYPT_COST);
    }
    if (user.isAdmin && !user.passwordHash) {
      throw new BadRequestException(
        'cannot promote a Trackee to admin without a password',
      );
    }
    if (user.isAdmin && !user.username) {
      throw new BadRequestException('admin Trackees require a username');
    }

    // Surface a duplicate username as a 400 rather than a raw 500 from the
    // partial unique index on `username`.
    if (user.username) {
      const clash = await this.users.findOne({
        where: { username: user.username },
      });
      if (clash && clash.id !== user.id) {
        throw new BadRequestException(`username "${user.username}" is taken`);
      }
    }

    const saved = await this.users.save(user);
    this.bus.emit({ kind: 'users:roster_changed' });
    return saved;
  }

  async deactivate(id: string): Promise<UserEntity> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`Trackee ${id} not found`);
    if (user.deactivatedAt) return user;
    user.deactivatedAt = new Date();
    const saved = await this.users.save(user);
    this.bus.emit({ kind: 'users:roster_changed' });
    return saved;
  }

  async verifyPassword(user: UserEntity, plaintext: string): Promise<boolean> {
    if (!user.passwordHash) return false;
    return bcrypt.compare(plaintext, user.passwordHash);
  }
}
