# Scaling considerations

Holocron is **designed for a single household**: roughly 2–6 Trackees, one wall tablet, one or two admin browsers. The architecture is a single Node process talking to a single Postgres — there is no horizontal scaling story, and adding one is not on the roadmap. This doc maps how cost grows along each axis so the assumptions stay honest if the household (or the data) gets unusually large.

See also: [architecture/overview.md](architecture/overview.md), [architecture/scheduling.md](architecture/scheduling.md), [architecture/realtime.md](architecture/realtime.md).

## Capacity envelope

| Axis | Comfortable | Strained | Notes |
| --- | --- | --- | --- |
| Trackees | ≤ 10 | 20+ | Every sweep iterates Trackees; rollover query is one per Trackee. |
| Tasks (active) | ≤ 100 | 300+ | Per-day occurrence generation is `O(active_tasks × assignees)`. |
| Occurrences alive at once | ≤ 500 | 2000+ | The deadline tick query filters by `status='active'` — bounded by tasks × Trackees × days-since-restart, not total history. |
| Goals (catalog) | ≤ 50 | 200+ | Read-only catalog; cost is in the UI render, not the server. |
| Devices per Trackee | ≤ 5 | 20+ | PiHole adapter is read-modify-write **per Device**. |
| Concurrent sockets | ≤ 10 | 50+ | All-broadcast gateway; per-emit cost grows linearly. |
| Transactions (lifetime) | ≤ 100k | 500k+ | Append-only; balance is `SUM`. Indexed on `(user_id, created_at)`. |
| Enforcement-log rows | ≤ 100k | 500k+ | Admin dashboard reads the most recent 100. No retention job. |

"Strained" doesn't mean broken — it means the implementation choices below stop being obviously fine and start being worth measuring.

## What's bounded by what

### Per-tick sweeps (every 60s)

All four scheduled sweeps run on the same heartbeat. Each one has a "do nothing" fast path with an indexed filter:

- **Deadline tick** ([miss.service.ts:58](../apps/api/src/tasks/miss.service.ts#L58)) — `SELECT … WHERE status='active' AND deadline ≤ now`. Cost = rows that *just* became overdue plus a per-Trackee schedule lookup (cached per sweep). For a household of 5 with 10 daily routines each, the worst tick processes ≤ 50 rows.
- **Pending-review sweep** ([pending-review.service.ts:183](../apps/api/src/pending-review/pending-review.service.ts#L183)) — `WHERE status='pending_review' AND pending_since < cutoff`. Bounded by the review backlog, not history.
- **Restriction wait-out sweep** ([restrictions.service.ts:124](../apps/api/src/restrictions/restrictions.service.ts#L124)) — `WHERE lifted_at IS NULL AND effective_expires_at ≤ now`. Bounded by the count of *currently active* Restrictions — typically 0–3.
- **Day rollover** ([daily-streak.service.ts:37](../apps/api/src/tasks/daily-streak.service.ts#L37)) — scans every active Trackee inside the 00:00–00:05 window. One day-bounded occurrence query per Trackee. `O(trackees)` per rollover.

If a household ever crossed into the thousands of pending or overdue rows, the obvious next step is to switch the four `setInterval` loops to `@nestjs/schedule` cron and add a row-limit per tick. The current implementation eats whatever it finds.

### Ledger reads

Balance is a per-call `SELECT SUM(amount) WHERE user_id = $1` ([transactions.service.ts:57](../apps/api/src/transactions/transactions.service.ts#L57)). With the `(user_id, created_at)` index this is an index-only scan whose cost is `O(rows for that user)`. At hundreds of thousands of rows it's still milliseconds; at millions, the next move is a materialized-view running balance refreshed on insert. Not needed today.

History queries ([historyFor](../apps/api/src/transactions/transactions.service.ts) — default `LIMIT 200`) are bounded by the limit. The UI never asks for "all transactions."

### Realtime fan-out

The gateway emits to **all connected sockets** — no per-user rooms ([realtime.gateway.ts:52-95](../apps/api/src/realtime/realtime.gateway.ts#L52)). Clients filter on `user_id` in the payload. For ≤ 10 sockets this saves more complexity than it costs; past ~50 sockets the per-emit broadcast cost dominates and you'd want rooms keyed by `user_id` (or by `household_id` if multi-household ever arrives).

Event payloads are intentionally thin (`{ at, user_id? }`) — the wire cost per event is bytes, not kilobytes. Clients re-fetch the affected REST resource, so adding a tenth event type doesn't grow socket traffic, just REST traffic.

### Enforcement adapters

- **Router (internet scope)** — one batched HTTP `PUT/DELETE` per `(Trackee, scope)`, with all the Trackee's Device IPs in one CSV body ([router-enforcement.service.ts](../apps/api/src/restrictions/router-enforcement.service.ts)). Cost is `O(1)` round-trips per activate/deactivate regardless of Device count.
- **PiHole (entertainment, games)** — read-modify-write per **Device** ([pihole-enforcement.service.ts](../apps/api/src/restrictions/pihole-enforcement.service.ts)). One activate touching a Trackee with 5 Devices = 5 RMW cycles. A household where one Trackee carries 20+ Devices is the failure mode here; PiHole's own rate limiting is the constraint before our code is.

Both adapters are **fire-and-forget**: a failed call logs to `enforcement_log` and does not retry. The in-app Restriction state is authoritative; recovering from an unreachable adapter is operator work (fix the device, then `liftEarly + re-apply` if needed).

### Presence reconciliation

`reconcileForUser` ([presence-reconciliation.service.ts:58](../apps/api/src/presence/presence-reconciliation.service.ts#L58)) is bounded by the affected date range:

- **Vacation-window edit** — range = union of added/removed windows. Tight; one Trackee × N days.
- **Recurring-rule / grid / epoch change** — open-ended, falls back to a **trailing 90 days** ([presence-reconciliation.service.ts:21](../apps/api/src/presence/presence-reconciliation.service.ts#L21)). Older Miss effects are not retroactively reversed.

90 days × ~10 daily occurrences = ~900 rows scanned per recurring-rule edit. Fast.

### Occurrence generation

`generateForDate` ([occurrences.service.ts:91](../apps/api/src/tasks/occurrences.service.ts#L91)) iterates `active_tasks × assignees` and inserts with an existence check per row. The uniqueness predicate (`task × user × day`) makes re-runs idempotent. Cost grows linearly with active tasks and Trackees.

There is **no daily timer** that calls this — see [engines/recurrence.md](engines/recurrence.md). It runs at boot and on every task CRUD. If a long-running container ever crosses a day boundary with no task edits, "tomorrow's" occurrences won't materialize until the next admin action or restart. A daily auto-generator is an easy add when needed.

## What does *not* scale

Honest list:

- **Multi-household isolation** — there's no `household_id` on any table. Adding one is a schema change touching every entity.
- **Per-user socket filtering** — the gateway broadcasts globally. Fine until sockets grow.
- **Adapter retries / backoff** — none. A flaky PiHole means missed enforcement.
- **Background queues** — none. All work is synchronous in the request thread or a sweep tick. Long-running jobs would block the heartbeat.
- **Transaction archival** — none. The ledger grows forever. At 10 rows/day × 5 Trackees × 5 years that's ~91k rows — still small. At 100×/day it's 900k and the SUM is still trivially indexed.
- **Cluster mode** — none. Two Node processes against one DB would double-emit timers and corrupt streak/restriction state. If horizontal scaling ever lands, pull the four sweeps into a dedicated worker singleton.

## When to revisit

A rule of thumb: if any of these become true, the next architectural pass should redesign that piece — not before.

- More than 20 Trackees in one household.
- More than 1,000 active occurrences alive at one moment.
- More than 50 concurrent sockets.
- Sustained adapter call rate above ~1 per second.
- A second household needs to live on the same instance.

Until then, the single-instance, in-process-scheduler, all-broadcast model is doing exactly the job it was sized for.

## Files to read

- [apps/api/src/transactions/transactions.service.ts](../apps/api/src/transactions/transactions.service.ts)
- [apps/api/src/tasks/miss.service.ts](../apps/api/src/tasks/miss.service.ts) (`fireDeadlineTick`)
- [apps/api/src/tasks/daily-streak.service.ts](../apps/api/src/tasks/daily-streak.service.ts) (`rolloverDay`)
- [apps/api/src/restrictions/restrictions.service.ts](../apps/api/src/restrictions/restrictions.service.ts) (`sweepExpired`)
- [apps/api/src/presence/presence-reconciliation.service.ts](../apps/api/src/presence/presence-reconciliation.service.ts)
- [apps/api/src/restrictions/router-enforcement.service.ts](../apps/api/src/restrictions/router-enforcement.service.ts), [pihole-enforcement.service.ts](../apps/api/src/restrictions/pihole-enforcement.service.ts)
