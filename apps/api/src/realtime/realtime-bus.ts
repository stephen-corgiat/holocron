import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

/**
 * In-process realtime event bus. Replaces the six per-module
 * `*-events.service.ts` files; one Subject, one named event union.
 *
 * Services call `bus.emit({ kind: '...', ... })`. The `RealtimeGateway`
 * subscribes once and maps each event to its wire payload — the gateway
 * stays the single owner of the over-the-wire shape (event name + JSON
 * envelope including `at: ISO`).
 *
 * Lives in its own leaf module (`RealtimeBusModule`) so feature modules can
 * import it without dragging in the gateway + Auth dependency. Avoids the
 * cycle previously documented on `RosterEventsService`.
 */
export type RealtimeEvent =
  | { kind: 'users:roster_changed' }
  | { kind: 'tasks:changed' }
  | { kind: 'transactions:changed'; userId: string }
  | { kind: 'goals:changed' }
  | {
      kind: 'goals:completed';
      userId: string;
      goalId: string;
      goalName: string;
      amount: number;
      celebrationVariantId: string | null;
    }
  | { kind: 'goals:user-changed'; userId: string }
  | { kind: 'restrictions:changed'; userId: string }
  | { kind: 'audible_warning:fire'; at: Date }
  // Deliberately diverges from the bare `{at}` nudges above: the HA event
  // carries the shaped HaSnapshot delta itself, so the tablet updates with no
  // follow-up HTTP round-trip. The delta is
  // an opaque pre-shaped FE payload here so this leaf module stays free of HA
  // types. Never emitted when the HA module is absent.
  | { kind: 'ha:state_changed'; delta: Record<string, unknown> };

@Injectable()
export class RealtimeBus {
  private readonly subject = new Subject<RealtimeEvent>();

  emit(event: RealtimeEvent): void {
    this.subject.next(event);
  }

  asObservable(): Observable<RealtimeEvent> {
    return this.subject.asObservable();
  }
}
