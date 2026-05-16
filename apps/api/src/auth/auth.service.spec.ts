import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { UserEntity } from '../users/user.entity';

function makeUser(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: 'user-1',
    username: 'admin',
    displayName: 'Admin',
    passwordHash: bcrypt.hashSync('correct-horse', 4),
    isAdmin: true,
    isRestrictable: false,
    routerId: null,
    avatar: null,
    color: null,
    createdAt: new Date(),
    ...overrides,
  } as UserEntity;
}

function makeService(user?: UserEntity | null) {
  const usersStub = {
    findByUsername: jest.fn().mockResolvedValue(user ?? null),
    findById: jest.fn().mockResolvedValue(user ?? null),
    verifyPassword: (u: UserEntity, p: string) =>
      bcrypt.compare(p, u.passwordHash ?? ''),
  } as unknown as UsersService;
  const jwt = new JwtService({ secret: 'test-secret-thats-long-enough' });
  const config = {
    get: (k: string) => (k === 'JWT_ADMIN_TTL' ? '1h' : undefined),
  } as unknown as ConfigService;
  return { svc: new AuthService(usersStub, jwt, config), jwt };
}

describe('AuthService', () => {
  describe('loginAdmin', () => {
    it('rejects unknown usernames', async () => {
      const { svc } = makeService(null);
      await expect(svc.loginAdmin('nobody', 'x')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects wrong passwords', async () => {
      const { svc } = makeService(makeUser());
      await expect(svc.loginAdmin('admin', 'wrong')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects valid users without is_admin', async () => {
      const { svc } = makeService(makeUser({ isAdmin: false }));
      await expect(
        svc.loginAdmin('admin', 'correct-horse'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('issues a JWT carrying is_admin: true on success', async () => {
      const { svc, jwt } = makeService(makeUser());
      const { token } = await svc.loginAdmin('admin', 'correct-horse');
      const decoded = jwt.verify<Record<string, unknown>>(token);
      expect(decoded.kind).toBe('admin');
      expect(decoded.is_admin).toBe(true);
    });
  });

  describe('tablet enrollment', () => {
    it('codes are one-time use', async () => {
      const { svc } = makeService(makeUser());
      const { code } = svc.createEnrollmentCode('admin-1');
      await svc.redeemEnrollmentCode(code);
      await expect(svc.redeemEnrollmentCode(code)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('redemption mints a tablet JWT (no is_admin)', async () => {
      const { svc, jwt } = makeService(makeUser());
      const { code } = svc.createEnrollmentCode('admin-1');
      const { token } = await svc.redeemEnrollmentCode(code);
      const decoded = jwt.verify<Record<string, unknown>>(token);
      expect(decoded.kind).toBe('tablet');
      expect(decoded.is_admin).toBe(false);
      expect(decoded.enrolled_by).toBe('admin-1');
    });

    it('rejects nonsense codes', async () => {
      const { svc } = makeService(makeUser());
      await expect(
        svc.redeemEnrollmentCode('NOPENOPE'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('accepts hyphenated and case-insensitive code formats', async () => {
      const { svc } = makeService(makeUser());
      const { code } = svc.createEnrollmentCode('admin-1');
      const messy = code.toLowerCase().replace('-', '');
      await expect(svc.redeemEnrollmentCode(messy)).resolves.toMatchObject({
        enrolledBy: 'admin-1',
      });
    });
  });

  describe('verifyToken', () => {
    it('round-trips an admin token', async () => {
      const { svc } = makeService(makeUser());
      const { token } = await svc.loginAdmin('admin', 'correct-horse');
      const session = await svc.verifyToken(token);
      expect(session.kind).toBe('admin');
    });

    it('rejects garbage', async () => {
      const { svc } = makeService(makeUser());
      await expect(svc.verifyToken('not.a.jwt')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
