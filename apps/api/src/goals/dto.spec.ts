import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateGoalDto, UpdateGoalDto } from './dto';

const baseCreate = {
  name: 'Test Goal',
  category_id: '8b3c4f44-2e6f-4c4f-9b1b-7f3c1234abcd',
  completion_limit: 1,
  limit_window: 'week' as const,
};

describe('CreateGoalDto tier_values validation', () => {
  it('accepts a flat goal whose payload includes an empty tier_values array', async () => {
    const dto = plainToInstance(CreateGoalDto, {
      ...baseCreate,
      kind: 'flat',
      points: 10,
      tier_values: [],
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('accepts a flat goal with tier_values omitted', async () => {
    const dto = plainToInstance(CreateGoalDto, {
      ...baseCreate,
      kind: 'flat',
      points: 10,
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('accepts a tiered goal with at least one tier value', async () => {
    const dto = plainToInstance(CreateGoalDto, {
      ...baseCreate,
      kind: 'tiered',
      tier_values: [10, 20, 30],
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('rejects a tiered goal with an empty tier_values array', async () => {
    const dto = plainToInstance(CreateGoalDto, {
      ...baseCreate,
      kind: 'tiered',
      tier_values: [],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('tier_values');
    expect(errors[0].constraints).toHaveProperty('arrayMinSize');
  });
});

describe('UpdateGoalDto tier_values validation', () => {
  it('accepts a flat-goal patch carrying tier_values=[]', async () => {
    const dto = plainToInstance(UpdateGoalDto, {
      kind: 'flat',
      points: 10,
      tier_values: [],
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('rejects a tiered-goal patch with an empty tier_values array', async () => {
    const dto = plainToInstance(UpdateGoalDto, {
      kind: 'tiered',
      tier_values: [],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('tier_values');
    expect(errors[0].constraints).toHaveProperty('arrayMinSize');
  });
});
