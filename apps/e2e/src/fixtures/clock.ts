import type { Page } from '@playwright/test';
import type { ApiClient } from './api-client';

export type TickWhich = 'all' | 'miss' | 'pending' | 'restrictions' | 'audible' | 'streak';

/**
 * Drives the API's fake clock AND pins the browser's `Date` to match it.
 *
 * The tablet reads "now" from the browser (`new Date()` / `Date.now()`) for
 * client-side time logic — a reminder row auto-completes when
 * `scheduled <= now`, and the weekly-earned graph buckets transactions against
 * the browser's current ISO week. Without syncing, a fixed past server clock
 * leaves the browser at the real "today", so reminders render already-done and
 * the weekly graph buckets to the wrong week.
 *
 * Pinning the browser via Playwright's `page.clock.setFixedTime` keeps both in
 * lockstep so specs can use literal civil times. `setFixedTime` only fakes the
 * `Date` reads — real timers keep running, so websockets and the tablet's 30s
 * refresh interval are unaffected.
 */
export function clockFixture(api: ApiClient, page: Page) {
  async function pinBrowser(date: Date): Promise<void> {
    // setSystemTime (rather than setFixedTime or install): point the browser's
    // wall clock at `date` and let it tick from there in real time, leaving the
    // timer functions untouched. That keeps socket.io heartbeats and the
    // tablet's 30s refresh interval alive — `install` pauses timers until you
    // fast-forward, which would starve them.
    await page.clock.setSystemTime(date);
  }
  return {
    async get(): Promise<Date> {
      const res = await api.get<{ iso: string }>('/_e2e/clock');
      return new Date(res.iso);
    },
    async set(date: Date): Promise<void> {
      await api.post('/_e2e/clock/set', { iso: date.toISOString() });
      await pinBrowser(date);
    },
    async advance(ms: number): Promise<void> {
      const res = await api.post<{ iso: string }>('/_e2e/clock/advance', { ms });
      await pinBrowser(new Date(res.iso));
    },
    async tick(which: TickWhich = 'all'): Promise<unknown> {
      return api.post('/_e2e/scheduler/tick', { which });
    },
    /** Re-pin the browser clock to the API's current fake time. */
    async syncBrowser(): Promise<void> {
      const res = await api.get<{ iso: string }>('/_e2e/clock');
      await pinBrowser(new Date(res.iso));
    },
  };
}

export type ClockFixture = ReturnType<typeof clockFixture>;
