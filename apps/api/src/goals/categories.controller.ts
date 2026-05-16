import {
  Body,
  Controller,
  Delete,
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
import { CategoriesService } from './categories.service';
import { CategoryEntity } from './category.entity';
import { CreateCategoryDto, UpdateCategoryDto } from './dto';
import { RealtimeBus } from '../realtime/realtime-bus';

interface CategoryView {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

function toView(c: CategoryEntity): CategoryView {
  return {
    id: c.id,
    name: c.name,
    sort_order: c.sortOrder,
    created_at: c.createdAt.toISOString(),
  };
}

@Controller('categories')
@UseGuards(JwtAuthGuard)
export class CategoriesController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly bus: RealtimeBus,
  ) {}

  /** Both admin browser and tablet need the category list for the catalog. */
  @Get()
  async list(): Promise<{ categories: CategoryView[] }> {
    const rows = await this.categories.list();
    return { categories: rows.map(toView) };
  }

  @Post()
  @UseGuards(AdminGuard)
  async create(@Body() dto: CreateCategoryDto): Promise<CategoryView> {
    const c = await this.categories.create({
      name: dto.name,
      sortOrder: dto.sort_order,
    });
    this.bus.emit({ kind: 'goals:changed' });
    return toView(c);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryView> {
    const c = await this.categories.update(id, {
      name: dto.name,
      sortOrder: dto.sort_order,
    });
    this.bus.emit({ kind: 'goals:changed' });
    return toView(c);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.categories.remove(id);
    this.bus.emit({ kind: 'goals:changed' });
  }
}
