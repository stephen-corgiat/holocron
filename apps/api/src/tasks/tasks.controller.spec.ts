import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { OccurrencesService } from './occurrences.service';
import { RealtimeBus } from '../realtime/realtime-bus';
import { Clock } from '../clock/clock';
import { TaskKind } from './task.entity';

/**
 * Regression guard: `GET /tasks?kind=windowed` must filter to windowed tasks.
 * The original bug dropped `windowed` through to `undefined`, returning every
 * task — which made reminders leak into the admin Windowed view as "one-shot".
 */
describe('TasksController.list — kind filter', () => {
  function makeController() {
    const seen: Array<TaskKind | undefined> = [];
    const tasks = {
      list: jest.fn(async (kind?: TaskKind) => {
        seen.push(kind);
        return [];
      }),
    } as unknown as TasksService;
    const occurrences = {} as unknown as OccurrencesService;
    const bus = {} as unknown as RealtimeBus;
    const clock = { now: () => new Date() } as unknown as Clock;
    const controller = new TasksController(tasks, occurrences, bus, clock);
    return { controller, seen };
  }

  it.each([
    ['reminder', 'reminder'],
    ['recurring', 'recurring'],
    ['windowed', 'windowed'],
  ])('maps kind=%s to the %s filter', async (kind, expected) => {
    const { controller, seen } = makeController();
    await controller.list(kind);
    expect(seen).toEqual([expected]);
  });

  it('passes undefined (all kinds) when no kind is given', async () => {
    const { controller, seen } = makeController();
    await controller.list(undefined);
    expect(seen).toEqual([undefined]);
  });

  it('passes undefined for an unknown kind', async () => {
    const { controller, seen } = makeController();
    await controller.list('bogus');
    expect(seen).toEqual([undefined]);
  });
});
