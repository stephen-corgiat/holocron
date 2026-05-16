import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoryEntity } from './category.entity';
import { GoalEntity } from './goal.entity';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(CategoryEntity)
    private readonly categories: Repository<CategoryEntity>,
    @InjectRepository(GoalEntity)
    private readonly goals: Repository<GoalEntity>,
  ) {}

  list(): Promise<CategoryEntity[]> {
    return this.categories.find({ order: { sortOrder: 'ASC', createdAt: 'ASC' } });
  }

  async findById(id: string): Promise<CategoryEntity> {
    const c = await this.categories.findOne({ where: { id } });
    if (!c) throw new NotFoundException(`category ${id} not found`);
    return c;
  }

  async create(input: { name: string; sortOrder?: number }): Promise<CategoryEntity> {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('category name required');
    const entity = this.categories.create({
      name,
      sortOrder: input.sortOrder ?? 0,
    });
    return this.categories.save(entity);
  }

  async update(
    id: string,
    patch: { name?: string; sortOrder?: number },
  ): Promise<CategoryEntity> {
    const c = await this.findById(id);
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (!trimmed) throw new BadRequestException('category name required');
      c.name = trimmed;
    }
    if (patch.sortOrder !== undefined) c.sortOrder = patch.sortOrder;
    return this.categories.save(c);
  }

  async remove(id: string): Promise<void> {
    const c = await this.findById(id);
    const refCount = await this.goals.count({ where: { categoryId: id } });
    if (refCount > 0) {
      throw new BadRequestException(
        `category "${c.name}" still has ${refCount} goal(s); reassign or delete those goals first`,
      );
    }
    await this.categories.remove(c);
  }
}
