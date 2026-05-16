import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { PendingReviewService, PendingCard } from './pending-review.service';

@Controller('admin/pending-review')
@UseGuards(JwtAuthGuard, AdminGuard)
export class PendingReviewController {
  constructor(private readonly pending: PendingReviewService) {}

  @Get()
  async list(): Promise<{ pending: PendingCard[] }> {
    const pending = await this.pending.list();
    return { pending };
  }

  @Post(':id/approve')
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ id: string; status: 'complete' }> {
    const adminUserId = adminIdOf(req);
    const occ = await this.pending.approve(id, adminUserId);
    return { id: occ.id, status: 'complete' };
  }

  @Post(':id/reject')
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ id: string; status: 'missed' }> {
    const adminUserId = adminIdOf(req);
    const occ = await this.pending.reject(id, adminUserId);
    return { id: occ.id, status: 'missed' };
  }

  @Post('approve-all')
  async approveAll(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ approved: number }> {
    const adminUserId = adminIdOf(req);
    return this.pending.approveAll(adminUserId);
  }
}

function adminIdOf(req: AuthenticatedRequest): string {
  const s = req.session;
  if (!s || s.kind !== 'admin') return '';
  return s.sub;
}
