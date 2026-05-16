import { firstValueFrom, take, toArray } from 'rxjs';
import { RealtimeBus, RealtimeEvent } from './realtime-bus';

describe('RealtimeBus', () => {
  it('emits events to subscribers', async () => {
    const bus = new RealtimeBus();
    const collected = firstValueFrom(
      bus.asObservable().pipe(take(3), toArray()),
    );
    bus.emit({ kind: 'tasks:changed' });
    bus.emit({ kind: 'transactions:changed', userId: 'u-bob' });
    bus.emit({ kind: 'audible_warning:fire', at: new Date('2026-05-15T18:00:00Z') });

    const events = await collected;
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ kind: 'tasks:changed' });
    expect((events[1] as Extract<RealtimeEvent, { kind: 'transactions:changed' }>).userId).toBe(
      'u-bob',
    );
    expect((events[2] as Extract<RealtimeEvent, { kind: 'audible_warning:fire' }>).at).toEqual(
      new Date('2026-05-15T18:00:00Z'),
    );
  });

  it('late subscribers do not see prior events (Subject, not BehaviorSubject)', async () => {
    const bus = new RealtimeBus();
    bus.emit({ kind: 'tasks:changed' });

    let received: RealtimeEvent[] = [];
    bus.asObservable().subscribe((e) => received.push(e));
    expect(received).toEqual([]);

    bus.emit({ kind: 'goals:changed' });
    expect(received).toEqual([{ kind: 'goals:changed' }]);
  });
});
