import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'node:crypto';
import { UsersService } from '../users/users.service';
import { UserEntity } from '../users/user.entity';
import {
  AdminJwtPayload,
  SessionJwtPayload,
  TabletJwtPayload,
} from './jwt-payload';

const TABLET_TOKEN_TTL = '3650d';

interface EnrollmentCode {
  code: string;
  adminUserId: string;
  expiresAt: number;
}

@Injectable()
export class AuthService {
  // In-memory enrollment code store: codes are short-lived (5min) and one-use,
  // so persisting them across an API restart isn't worth a table.
  private readonly enrollmentCodes = new Map<string, EnrollmentCode>();

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async loginAdmin(
    username: string,
    password: string,
  ): Promise<{ token: string; user: UserEntity }> {
    const user = await this.users.findByUsername(username);
    if (!user) throw new UnauthorizedException('invalid credentials');
    const ok = await this.users.verifyPassword(user, password);
    if (!ok) throw new UnauthorizedException('invalid credentials');
    if (!user.isAdmin) {
      throw new UnauthorizedException(
        'only admin users may sign in to the admin browser',
      );
    }
    if (!user.username) {
      // Defense in depth — admins always have a username (createUser enforces),
      // but the column is nullable for non-admin Trackees so the type allows null.
      throw new UnauthorizedException('admin user is missing a login username');
    }
    const payload: AdminJwtPayload = {
      sub: user.id,
      kind: 'admin',
      is_admin: true,
      username: user.username,
    };
    // jsonwebtoken types expiresIn as an ms-style template literal (e.g.
    // '12h'); the env value is an arbitrary string, validated at sign time.
    const ttl = (this.config.get<string>('JWT_ADMIN_TTL') ??
      '12h') as JwtSignOptions['expiresIn'];
    const token = await this.jwt.signAsync(payload, { expiresIn: ttl });
    return { token, user };
  }

  /** Admin issues an enrollment code from a signed-in browser. */
  createEnrollmentCode(adminUserId: string): {
    code: string;
    expiresAt: Date;
  } {
    this.purgeExpiredEnrollmentCodes();
    const code = formatEnrollmentCode(randomBytes(4));
    const expiresAt = Date.now() + 5 * 60 * 1000;
    this.enrollmentCodes.set(code, {
      code,
      adminUserId,
      expiresAt,
    });
    return { code, expiresAt: new Date(expiresAt) };
  }

  /** Tablet redeems an enrollment code for a long-lived household-tablet JWT. */
  async redeemEnrollmentCode(
    code: string,
  ): Promise<{ token: string; enrolledBy: string }> {
    this.purgeExpiredEnrollmentCodes();
    const normalized = code.trim().toUpperCase().replace(/-/g, '');
    const entry = this.findEnrollmentByNormalizedCode(normalized);
    if (!entry) throw new UnauthorizedException('invalid enrollment code');
    this.enrollmentCodes.delete(entry.code);

    const payload: TabletJwtPayload = {
      sub: `tablet:${randomUUID()}`,
      kind: 'tablet',
      is_admin: false,
      enrolled_by: entry.adminUserId,
    };
    const token = await this.jwt.signAsync(payload, {
      expiresIn: TABLET_TOKEN_TTL,
    });
    return { token, enrolledBy: entry.adminUserId };
  }

  async verifyToken(token: string): Promise<SessionJwtPayload> {
    try {
      const payload = await this.jwt.verifyAsync<SessionJwtPayload>(token);
      if (payload.kind !== 'admin' && payload.kind !== 'tablet') {
        throw new UnauthorizedException('unknown session kind');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('invalid or expired token');
    }
  }

  private purgeExpiredEnrollmentCodes(): void {
    const now = Date.now();
    for (const [code, entry] of this.enrollmentCodes) {
      if (entry.expiresAt <= now) this.enrollmentCodes.delete(code);
    }
  }

  private findEnrollmentByNormalizedCode(
    normalized: string,
  ): EnrollmentCode | undefined {
    for (const entry of this.enrollmentCodes.values()) {
      if (entry.code.replace(/-/g, '') === normalized) return entry;
    }
    return undefined;
  }
}

function formatEnrollmentCode(bytes: Buffer): string {
  // 8 hex chars → "ABCD-EF12". Easy to read off a screen and type on a tablet.
  const hex = bytes.toString('hex').toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}
