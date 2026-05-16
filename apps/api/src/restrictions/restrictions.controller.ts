import {
  Body,
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
import { RestrictionsService } from './restrictions.service';
import {
  AskParentDto,
  BlockNowDto,
  RestrictionsOverviewResponse,
  TabletRestrictionView,
  UserHasActiveRestriction,
} from './dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class RestrictionsController {
  constructor(private readonly service: RestrictionsService) {}

  /**
   * Admin overview — scope cards + active restrictions + open remediation
   * requests + (placeholder) enforcement log.
   */
  @Get('admin/restrictions')
  @UseGuards(AdminGuard)
  async overview(): Promise<RestrictionsOverviewResponse> {
    return this.service.overview();
  }

  /** Admin "Block now". Creates an AdminCause. */
  @Post('admin/restrictions/block-now')
  @UseGuards(AdminGuard)
  async blockNow(
    @Body() dto: BlockNowDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ id: string }> {
    const adminUserId = adminIdOf(req);
    const restriction = await this.service.applyAdminCause({
      user_id: dto.user_id,
      scope: dto.scope,
      admin_user_id: adminUserId,
      reason: dto.reason ?? null,
    });
    return { id: restriction.id };
  }

  /** Admin "Lift early" — clears all Causes and stamps `lifted_at`. */
  @Post('admin/restrictions/:id/lift')
  @UseGuards(AdminGuard)
  async lift(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string; lifted: true }> {
    await this.service.liftEarly(id);
    return { id, lifted: true };
  }

  /** Admin resolve an "Ask a parent" remediation request (no lift effect). */
  @Post('admin/restrictions/remediation-requests/:id/resolve')
  @UseGuards(AdminGuard)
  async resolveRequest(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string; status: 'resolved' }> {
    await this.service.resolveRemediationRequest(id);
    return { id, status: 'resolved' };
  }

  /**
   * Tablet-side: active Restrictions for the active Trackee. Reachable from
   * both tablet sessions and admin tokens; auth is the JWT guard.
   */
  @Get('restrictions/trackee/:userId')
  async forTrackee(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<TabletRestrictionView> {
    return this.service.forTrackee(userId);
  }

  /**
   * Tab-badge feed: which Trackees currently have any active Restriction.
   * Used by the tablet to render the `lock` icon on inactive tabs.
   */
  @Get('restrictions/active-users')
  async activeUsers(): Promise<{ users: UserHasActiveRestriction[] }> {
    const users = await this.service.listUsersWithActive();
    return { users };
  }

  /** Tablet "Ask a parent" — records a remediation request, no lift. */
  @Post('restrictions/remediation-requests')
  async askParent(
    @Body() dto: AskParentDto,
  ): Promise<{ id: string; status: 'open' }> {
    const row = await this.service.createRemediationRequest({
      user_id: dto.user_id,
      scope: dto.scope,
      note: dto.note ?? null,
    });
    return { id: row.id, status: 'open' };
  }
}

function adminIdOf(req: AuthenticatedRequest): string {
  const s = req.session;
  if (!s || s.kind !== 'admin') return '';
  return s.sub;
}
