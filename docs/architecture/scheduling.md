# Scheduling & time

Every scheduled job is an in-process `setInterval` registered on a Nest module's `onModuleInit`. There is no external scheduler (no cron, no Bull/BullMQ, no `@nestjs/schedule` yet). Each timer takes a snapshot from the injected `Clock` and runs to completion before the next tick — they're idempotent and can safely fire on a heartbeat cadence.

See also: [overview.md](overview.md), [../engines/miss-detection.md](../engines/miss-detection.md), [../engines/pending-review.md](../engines/pending-review.md), [../engines/streaks.md](../engines/streaks.md), [../engines/restrictions.md](../engines/restrictions.md), [../testing.md](../testing.md).

## Timers in the API

| Timer | Cadence | Effect | Code |
| --- | --- | --- | --- |
| Deadline tick | 60s | Fires Misses for any active occurrence past its deadline | [tasks.module.ts:99-105](../../apps/api/src/tasks/tasks.module.ts#L99) → [miss.service.ts:58](../../apps/api/src/tasks/miss.service.ts#L58) |
| Day rollover | 60s; gates on `minutesOfDayInTz(now, tz) < 5` | Classifies the household-local "yesterday" (`addDaysInTz(now, -1, tz)`) for every Trackee, posts daily-routine-streak bonuses, advances/breaks the streak counter | [tasks.module.ts](../../apps/api/src/tasks/tasks.module.ts) → [daily-streak.service.ts](../../apps/api/src/tasks/daily-streak.service.ts) |
| Pending-review sweep | 60s | Auto-rejects pending-review occurrences past `pendingReviewTimeoutMs` (household setting) | [pending-review.module.ts:43-52](../../apps/api/src/pending-review/pending-review.module.ts#L43) → [pending-review.service.ts:183](../../apps/api/src/pending-review/pending-review.service.ts#L183) |
| Restriction wait-out sweep | 60s | Lifts any Restriction whose `effective_expires_at` has passed | [restrictions.module.ts:167-181](../../apps/api/src/restrictions/restrictions.module.ts#L167) → `RestrictionsService.sweepExpired` |
| Audible warning tick | depends on AudibleWarningModule | Emits `audible_warning:fire` if the household's HH:MM matches and conditions are met | [apps/api/src/audible-warning/](../../apps/api/src/audible-warning/) |

All five are bypassed when `E2E_TEST_MODE=true` — tests drive each one explicitly via the `/_e2e/scheduler/tick` endpoint.

### Why every minute?

The four sweeps each have a "do nothing" fast path (empty query, no rows) and the household has tens of occurrences in flight at most. A minute is a low-latency upper bound that keeps the architecture simple — no precision cron, no jitter handling, no per-task scheduling. The day-rollover timer also ticks every minute but only does work in the first five minutes after **household-local** midnight — the gate and the "yesterday" it rolls over are both computed in the household zone, not the process zone (ADR-0007).

## The `Clock` port

Every service that reads "now" for a side effect about to happen injects [`CLOCK`](../../apps/api/src/clock/clock.ts). Two implementations:

- **`SystemClock`** — `new Date()`. Bound when `E2E_TEST_MODE !== 'true'`.
- **`FakeClock`** — backed by a mutable internal instant. Bound when `E2E_TEST_MODE === 'true'`. Tests drive it via `/_e2e/clock/set` and `/_e2e/clock/advance`.

Wiring: [clock.module.ts](../../apps/api/src/clock/clock.module.ts). The `ClockModule` is `@Global()` so feature modules don't re-import it.

Pure date math on user-supplied dates (e.g., recurrence pattern expansion) still uses native `Date` directly — only the "now for a side effect" reads go through `Clock`.

## E2E test control surface

When `E2E_TEST_MODE=true`, an additional `/_e2e/*` controller is mounted ([e2e.controller.ts](../../apps/api/src/e2e/e2e.controller.ts)). Endpoints relevant to scheduling:

| Endpoint | Body | Purpose |
| --- | --- | --- |
| `GET /_e2e/clock` | — | Read current `FakeClock` instant |
| `POST /_e2e/clock/set` | `{ to: ISO }` | Pin the fake clock |
| `POST /_e2e/clock/advance` | `{ ms }` | Advance by milliseconds |
| `POST /_e2e/scheduler/tick` | `{ which?: 'all'\|'miss'\|'pending'\|'restrictions'\|'audible'\|'streak' }` | Run one or all sweeps under the current fake clock |
| `POST /_e2e/occurrences/generate` | `{ date }` | Force-generate occurrences for a date |
| `POST /_e2e/reset` | — | Truncate domain tables to a clean state |

Tests typically set the clock, mark some occurrences complete, advance the clock past a deadline, call `/_e2e/scheduler/tick`, and assert the resulting state. See [../testing.md](../testing.md).

## Idempotency invariants

- **Deadline tick**: queries only `status='active'` occurrences past their deadline; Miss flips status to `missed`, so the same occurrence cannot fire twice.
- **Day rollover**: keyed off `DailyStreakEntity.last_qualifying_day`. Re-rolling the same day is a no-op for `advance`; the bonus check inspects existing earn rows for the day before posting.
- **Pending sweep**: only sweeps `status='pending_review'`; rejection flips to `missed`.
- **Restriction sweep**: only lifts Restrictions whose `effective_expires_at` has passed; lift is a single-pass DB transaction.

The cadence overlap (multiple timers running every 60s) is safe — each one filters on disjoint state.

## What's not scheduled

- Occurrence materialization is **boot-time** + on-read, not on a timer. See [../engines/recurrence.md](../engines/recurrence.md).
- Adapter retries: the router and PiHole adapters are fire-and-forget; failures are logged to `enforcement_log` and not retried. See [../engines/restrictions.md](../engines/restrictions.md).
- Cleanup jobs (old occurrences, old transactions): none. Retention is whatever the operator decides off-band.

## Files to read

- [apps/api/src/clock/clock.ts](../../apps/api/src/clock/clock.ts), [system-clock.ts](../../apps/api/src/clock/system-clock.ts), [fake-clock.ts](../../apps/api/src/clock/fake-clock.ts), [clock.module.ts](../../apps/api/src/clock/clock.module.ts)
- [apps/api/src/tasks/tasks.module.ts](../../apps/api/src/tasks/tasks.module.ts)
- [apps/api/src/pending-review/pending-review.module.ts](../../apps/api/src/pending-review/pending-review.module.ts)
- [apps/api/src/restrictions/restrictions.module.ts](../../apps/api/src/restrictions/restrictions.module.ts)
- [apps/api/src/e2e/e2e.controller.ts](../../apps/api/src/e2e/e2e.controller.ts)
