import { Injectable } from '@nestjs/common';
import { HaEventSource, HaStateChange } from '../ha/ha-event-source';
import { HaStatus } from '../ha/ha-snapshot';

/**
 * Controllable `state_changed` source for e2e. Comes up "connected" on
 * `start()` (so the events service seeds from {@link FakeHaHttpClient}); the
 * e2e controller then drives state changes and status transitions
 * deterministically. No timers, no real socket — the suite owns the clock.
 */
@Injectable()
export class FakeHaEventSource implements HaEventSource {
  private changeCb: (change: HaStateChange) => void = () => {};
  private statusCb: (status: HaStatus) => void = () => {};

  onChange(cb: (change: HaStateChange) => void): void {
    this.changeCb = cb;
  }

  onStatus(cb: (status: HaStatus) => void): void {
    this.statusCb = cb;
  }

  start(): void {
    this.statusCb('ok');
  }

  stop(): void {
    /* no-op: nothing persistent to tear down */
  }

  // ── e2e drivers ──────────────────────────────────────────────────────────
  fireChange(change: HaStateChange): void {
    this.changeCb(change);
  }

  setStatus(status: HaStatus): void {
    this.statusCb(status);
  }
}
