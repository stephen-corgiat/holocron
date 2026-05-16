import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CLOCK, Clock } from '../clock/clock';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { GoalsService } from './goals.service';
import { GoalEntity } from './goal.entity';
import { CompleteGoalDto, CreateGoalDto, UpdateGoalDto } from './dto';

interface GoalView {
  id: string;
  name: string;
  icon: string | null;
  note: string | null;
  category_id: string;
  kind: 'flat' | 'tiered';
  points: number;
  tier_values: number[];
  completion_limit: number;
  limit_window: 'day' | 'week' | 'month' | 'lifetime';
  show_in_catalog: boolean;
  usable_as_remediation: boolean;
  assigned_to_user_id: string | null;
  active: boolean;
  celebration_variant_id: string | null;
  created_at: string;
}

interface CatalogGoalView extends GoalView {
  remaining: number;
  maxed_out: boolean;
}

function toView(g: GoalEntity): GoalView {
  return {
    id: g.id,
    name: g.name,
    icon: g.icon,
    note: g.note,
    category_id: g.categoryId,
    kind: g.kind,
    points: g.points,
    tier_values: g.tierValues ?? [],
    completion_limit: g.completionLimit,
    limit_window: g.limitWindow,
    show_in_catalog: g.showInCatalog,
    usable_as_remediation: g.usableAsRemediation,
    assigned_to_user_id: g.assignedToUserId,
    active: g.active,
    celebration_variant_id: g.celebrationVariantId,
    created_at: g.createdAt.toISOString(),
  };
}

@Controller('goals')
@UseGuards(JwtAuthGuard)
export class GoalsController {
  constructor(
    private readonly goals: GoalsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Admin-only catalog of all goals (active or not). */
  @Get()
  @UseGuards(AdminGuard)
  async list(): Promise<{ goals: GoalView[] }> {
    const rows = await this.goals.list();
    return { goals: rows.map(toView) };
  }

  @Post()
  @UseGuards(AdminGuard)
  async create(@Body() dto: CreateGoalDto): Promise<GoalView> {
    const g = await this.goals.create({
      name: dto.name,
      icon: dto.icon ?? null,
      note: dto.note ?? null,
      categoryId: dto.category_id,
      kind: dto.kind,
      points: dto.points,
      tierValues: dto.tier_values,
      completionLimit: dto.completion_limit,
      limitWindow: dto.limit_window,
      showInCatalog: dto.show_in_catalog,
      usableAsRemediation: dto.usable_as_remediation,
      assignedToUserId: dto.assigned_to_user_id ?? null,
      active: dto.active,
      celebrationVariantId: dto.celebration_variant_id ?? null,
    });
    return toView(g);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGoalDto,
  ): Promise<GoalView> {
    const g = await this.goals.update(id, {
      name: dto.name,
      icon: dto.icon,
      note: dto.note,
      categoryId: dto.category_id,
      kind: dto.kind,
      points: dto.points,
      tierValues: dto.tier_values,
      completionLimit: dto.completion_limit,
      limitWindow: dto.limit_window,
      showInCatalog: dto.show_in_catalog,
      usableAsRemediation: dto.usable_as_remediation,
      assignedToUserId:
        dto.assigned_to_user_id === undefined ? undefined : dto.assigned_to_user_id,
      active: dto.active,
      celebrationVariantId:
        dto.celebration_variant_id === undefined
          ? undefined
          : dto.celebration_variant_id,
    });
    return toView(g);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.goals.remove(id);
  }

  /**
   * Tablet catalog for one Trackee: active+show_in_catalog goals, filtered to
   * those visible to this user (unassigned, or assigned-to). Each entry has a
   * `remaining` count for the current window and a `maxed_out` flag.
   */
  @Get('catalog')
  async catalog(
    @Query('user_id') userId?: string,
  ): Promise<{ goals: CatalogGoalView[] }> {
    if (!userId) throw new BadRequestException('user_id query param required');
    const list = await this.goals.catalogFor(userId);
    return {
      goals: list.map(({ goal, remaining, maxedOut }) => ({
        ...toView(goal),
        remaining,
        maxed_out: maxedOut,
      })),
    };
  }

  @Get('favorites')
  async favorites(
    @Query('user_id') userId?: string,
  ): Promise<{ goal_ids: string[] }> {
    if (!userId) throw new BadRequestException('user_id query param required');
    return { goal_ids: await this.goals.listFavorites(userId) };
  }

  @Put(':id/favorite')
  @HttpCode(204)
  async setFavorite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { favorite?: boolean },
    @Query('user_id') userId?: string,
  ): Promise<void> {
    if (!userId) throw new BadRequestException('user_id query param required');
    if (typeof body?.favorite !== 'boolean') {
      throw new BadRequestException('body.favorite (boolean) required');
    }
    await this.goals.setFavorite(userId, id, body.favorite);
  }

  @Get('in-progress')
  async inProgress(
    @Query('user_id') userId?: string,
  ): Promise<{ items: { goal_id: string; started_at: string }[] }> {
    if (!userId) throw new BadRequestException('user_id query param required');
    const rows = await this.goals.listInProgress(userId);
    return {
      items: rows.map((r) => ({
        goal_id: r.goalId,
        started_at: r.startedAt.toISOString(),
      })),
    };
  }

  @Post(':id/in-progress')
  @HttpCode(204)
  async addInProgress(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('user_id') userId?: string,
  ): Promise<void> {
    if (!userId) throw new BadRequestException('user_id query param required');
    await this.goals.addInProgress(userId, id, this.clock.now());
  }

  @Delete(':id/in-progress')
  @HttpCode(204)
  async removeInProgress(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('user_id') userId?: string,
  ): Promise<void> {
    if (!userId) throw new BadRequestException('user_id query param required');
    await this.goals.removeInProgress(userId, id);
  }

  @Get('recent-completions')
  async recentCompletions(
    @Query('user_id') userId?: string,
    @Query('limit') limit?: string,
  ): Promise<{ goal_ids: string[] }> {
    if (!userId) throw new BadRequestException('user_id query param required');
    const n = limit ? Number(limit) : 3;
    if (!Number.isInteger(n) || n < 1 || n > 20) {
      throw new BadRequestException('limit must be an integer in [1, 20]');
    }
    const rows = await this.goals.recentCompletions(userId, n);
    return { goal_ids: rows.map((r) => r.goalId) };
  }

  @Post(':id/complete')
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteGoalDto,
  ): Promise<{
    completion_id: string;
    amount: number;
    lifted_restriction_id: string | null;
  }> {
    if (dto.restriction_id) {
      const { completion, amount } = await this.goals.completeAsRemediation(
        id,
        dto.user_id,
        dto.restriction_id,
        this.clock.now(),
        dto.tier_value,
      );
      return {
        completion_id: completion.id,
        amount,
        lifted_restriction_id: dto.restriction_id,
      };
    }
    const { completion, amount } = await this.goals.complete(
      id,
      dto.user_id,
      this.clock.now(),
      dto.tier_value,
    );
    return {
      completion_id: completion.id,
      amount,
      lifted_restriction_id: null,
    };
  }
}
