import { Repository } from 'typeorm';
import { HouseholdSettingsEntity } from './household-settings.entity';
import { HouseholdSettingsService } from './household-settings.service';

/**
 * Minimal in-memory stand-in for the single-row settings repository. Only the
 * methods the service touches are implemented.
 */
function makeRepo(initial?: Partial<HouseholdSettingsEntity>): {
  repo: Repository<HouseholdSettingsEntity>;
  row: HouseholdSettingsEntity;
} {
  const row = { id: 1, ...initial } as HouseholdSettingsEntity;
  const repo = {
    findOne: jest.fn().mockResolvedValue(row),
    create: jest.fn((v: Partial<HouseholdSettingsEntity>) => v),
    save: jest.fn((v: HouseholdSettingsEntity) => Promise.resolve(v)),
  } as unknown as Repository<HouseholdSettingsEntity>;
  return { repo, row };
}

describe('HouseholdSettingsService.updateTimeZone — change listeners', () => {
  it('fires registered listeners with the new zone when it changes', async () => {
    const { repo } = makeRepo({ timeZone: 'UTC' });
    const service = new HouseholdSettingsService(repo);
    const listener = jest.fn().mockResolvedValue(undefined);
    service.onTimeZoneChange(listener);

    await service.updateTimeZone('America/Los_Angeles');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('America/Los_Angeles');
  });

  it('does not fire listeners when the zone is unchanged', async () => {
    const { repo } = makeRepo({ timeZone: 'America/Los_Angeles' });
    const service = new HouseholdSettingsService(repo);
    const listener = jest.fn().mockResolvedValue(undefined);
    service.onTimeZoneChange(listener);

    await service.updateTimeZone('America/Los_Angeles');

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('HouseholdSettingsService — daily bonus amount', () => {
  it('defaults to 5 when the column is unset', async () => {
    const { repo } = makeRepo();
    const service = new HouseholdSettingsService(repo);

    expect(await service.dailyBonusAmount()).toBe(5);
    expect((await service.view()).daily_bonus_amount).toBe(5);
  });

  it('persists an updated bonus and reflects it in the view', async () => {
    const { repo, row } = makeRepo({ dailyBonusAmount: 5 });
    const service = new HouseholdSettingsService(repo);

    const view = await service.updateDailyBonusAmount(8);

    expect(row.dailyBonusAmount).toBe(8);
    expect(view.daily_bonus_amount).toBe(8);
    expect(await service.dailyBonusAmount()).toBe(8);
  });
});
