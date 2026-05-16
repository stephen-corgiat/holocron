import { TasksModule } from './tasks.module';
import type { OccurrencesService } from './occurrences.service';
import type { DailyStreakService } from './daily-streak.service';

/**
 * Regression guard for the day-rollover gap: a long-running API process
 * showed an empty routine after household-local midnight because the rollover
 * timer rolled the streak but never materialized the new day's occurrences.
 * Occurrences only reappeared on the next restart or task save.
 */
describe('TasksModule.runDayRollover', () => {
  function makeModule() {
    const occurrences = {
      generateForDate: jest.fn().mockResolvedValue({ created: 0 }),
    };
    const dailyStreak = {
      rolloverDay: jest.fn().mockResolvedValue({ processed: 0, bonuses: 0 }),
    };
    const module = new TasksModule(
      occurrences as unknown as OccurrencesService,
      {} as never,
      dailyStreak as unknown as DailyStreakService,
      {} as never,
      {} as never,
    );
    return { module, occurrences, dailyStreak };
  }

  it('materializes the new day and rolls the streak for the day that just ended', async () => {
    const { module, occurrences, dailyStreak } = makeModule();
    // Just after America/Los_Angeles midnight (UTC-7 in June).
    const now = new Date('2026-06-02T07:01:00Z');

    await module.runDayRollover(now, 'America/Los_Angeles');

    expect(occurrences.generateForDate).toHaveBeenCalledWith(now);
    expect(dailyStreak.rolloverDay).toHaveBeenCalledTimes(1);
    const rolledDay = dailyStreak.rolloverDay.mock.calls[0][0] as Date;
    expect(rolledDay.getTime()).toBeLessThan(now.getTime());
  });

  it('still rolls the streak when occurrence generation fails', async () => {
    const { module, occurrences, dailyStreak } = makeModule();
    occurrences.generateForDate.mockRejectedValueOnce(new Error('db down'));

    await module.runDayRollover(
      new Date('2026-06-02T07:01:00Z'),
      'America/Los_Angeles',
    );

    expect(dailyStreak.rolloverDay).toHaveBeenCalledTimes(1);
  });

  it('still materializes the new day when the streak rollover fails', async () => {
    const { module, occurrences, dailyStreak } = makeModule();
    dailyStreak.rolloverDay.mockRejectedValueOnce(new Error('db down'));

    await module.runDayRollover(
      new Date('2026-06-02T07:01:00Z'),
      'America/Los_Angeles',
    );

    expect(occurrences.generateForDate).toHaveBeenCalledTimes(1);
  });
});
