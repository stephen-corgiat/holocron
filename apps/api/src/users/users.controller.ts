import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { UsersService } from './users.service';
import { UserEntity } from './user.entity';
import { CreateTrackeeDto, UpdateTrackeeDto } from './dto';

interface TrackeeView {
  id: string;
  display_name: string;
  is_admin: boolean;
  is_restrictable: boolean;
  router_id: string | null;
  avatar: string | null;
  color: string | null;
  username: string | null;
  deactivated_at: string | null;
  created_at: string;
  current_streak?: number;
}

function toView(user: UserEntity, streak?: number): TrackeeView {
  return {
    id: user.id,
    display_name: user.displayName,
    is_admin: user.isAdmin,
    is_restrictable: user.isRestrictable,
    router_id: user.routerId,
    avatar: user.avatar,
    color: user.color,
    username: user.username,
    deactivated_at: user.deactivatedAt
      ? user.deactivatedAt.toISOString()
      : null,
    created_at: user.createdAt.toISOString(),
    current_streak: streak ?? 0,
  };
}

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /**
   * Tab-strip roster for the wall tablet — and for the admin browser when it
   * just needs the active set. Admin or tablet sessions both qualify; the
   * payload exposes no admin-only fields.
   */
  @UseGuards(JwtAuthGuard)
  @Get('roster')
  async roster(): Promise<{ trackees: TrackeeView[] }> {
    const [trackees, streaks] = await Promise.all([
      this.users.roster(),
      this.users.streakMap(),
    ]);
    return {
      trackees: trackees.map((t) => toView(t, streaks.get(t.id) ?? 0)),
    };
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get()
  async list(): Promise<{ trackees: TrackeeView[] }> {
    const trackees = await this.users.list();
    return { trackees: trackees.map(toView) };
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post()
  async create(@Body() dto: CreateTrackeeDto): Promise<TrackeeView> {
    const created = await this.users.createUser({
      displayName: dto.display_name,
      isAdmin: dto.is_admin,
      isRestrictable: dto.is_restrictable,
      routerId: dto.router_id,
      avatar: dto.avatar ?? null,
      color: dto.color ?? null,
      password: dto.password,
      username: dto.username,
    });
    return toView(created);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTrackeeDto,
  ): Promise<TrackeeView> {
    const updated = await this.users.update(id, {
      displayName: dto.display_name,
      isAdmin: dto.is_admin,
      isRestrictable: dto.is_restrictable,
      routerId: dto.router_id,
      avatar: dto.avatar,
      color: dto.color,
      password: dto.password,
      username: dto.username,
    });
    return toView(updated);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post(':id/deactivate')
  @HttpCode(200)
  async deactivate(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TrackeeView> {
    const deactivated = await this.users.deactivate(id);
    return toView(deactivated);
  }
}
