import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthenticatedRequest } from './jwt-auth.guard';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const session = req.session;
    if (!session || session.kind !== 'admin' || !session.is_admin) {
      throw new ForbiddenException('admin capability required');
    }
    return true;
  }
}
