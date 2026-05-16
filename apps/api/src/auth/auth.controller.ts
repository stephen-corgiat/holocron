import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtAuthGuard, AuthenticatedRequest } from './jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { LoginDto, RedeemEnrollmentDto } from './dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    const { token, user } = await this.auth.loginAdmin(dto.username, dto.password);
    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.displayName,
        is_admin: user.isAdmin,
      },
    };
  }

  /** Admin browser only: mint a one-time enrollment code for a tablet. */
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('tablet/enrollment-code')
  async createEnrollmentCode(@Req() req: AuthenticatedRequest) {
    const session = req.session!;
    const result = this.auth.createEnrollmentCode(session.sub);
    return {
      code: result.code,
      expires_at: result.expiresAt.toISOString(),
    };
  }

  /** Tablet device: redeem the code for a long-lived household-tablet JWT. */
  @Post('tablet/enroll')
  async redeem(@Body() dto: RedeemEnrollmentDto) {
    const { token, enrolledBy } = await this.auth.redeemEnrollmentCode(dto.code);
    return { token, enrolled_by: enrolledBy };
  }

  @UseGuards(JwtAuthGuard)
  @Get('whoami')
  async whoami(@Req() req: AuthenticatedRequest) {
    const session = req.session!;
    if (session.kind === 'admin') {
      const user = await this.users.findById(session.sub);
      return {
        kind: 'admin' as const,
        is_admin: true,
        user: user
          ? {
              id: user.id,
              username: user.username,
              display_name: user.displayName,
              is_admin: user.isAdmin,
            }
          : null,
      };
    }
    return {
      kind: 'tablet' as const,
      is_admin: false,
      enrolled_by: session.enrolled_by,
    };
  }
}
