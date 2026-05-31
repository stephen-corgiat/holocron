# Testing

Two layers: unit tests (Jest) co-located with the API source, and end-to-end tests (Playwright) against a full Docker-Compose stack. The deterministic `Clock` abstraction is the spine of both — time-based logic never sleeps in tests.

See also: [architecture/scheduling.md](architecture/scheduling.md), [development.md](development.md).

## Unit tests

Pattern: `*.spec.ts` next to the file it tests, in [apps/api/src/](../apps/api/src/). Run with:

```bash
npm --workspace apps/api run test
```

### What gets unit-tested

- **Pure engines** — exhaustive coverage:
  - [tasks/recurrence/engine.spec.ts](../apps/api/src/tasks/recurrence/engine.spec.ts)
  - [tasks/resolution/miss-engine.spec.ts](../apps/api/src/tasks/resolution/miss-engine.spec.ts)
  - [tasks/resolution/escalation-ladder.spec.ts](../apps/api/src/tasks/resolution/escalation-ladder.spec.ts)
  - [tasks/daily-streak-engine.spec.ts](../apps/api/src/tasks/daily-streak-engine.spec.ts)
  - [restrictions/restriction-merge.spec.ts](../apps/api/src/restrictions/restriction-merge.spec.ts)
  - [presence/presence-resolver.spec.ts](../apps/api/src/presence/presence-resolver.spec.ts)
  - [presence/presence-reconcile.spec.ts](../apps/api/src/presence/presence-reconcile.spec.ts)
- **Services** — wire-up + side effects, against in-memory fake repositories (or a mocked `typeorm`), so the unit suite needs no database. Behaviour that depends on real SQL is covered by the e2e suite.
- **Adapters** — `RouterEnforcementService`, `PiHoleEnforcementService` against fake HTTP clients ([apps/api/src/e2e/fake-*-http-client.ts](../apps/api/src/e2e/)) — the same fakes the e2e suite uses.

### Fixture names

From [../CLAUDE.md](../CLAUDE.md#testing-conventions):

- **Trackees**: `Alice` (Admin, non-Restrictable) and `Bob` (non-Admin, Restrictable). Add `Carol`, `Dave` if needed.
- **Household**: `Test Household`.
- **Tasks / Goals**: `Test Task`, `Test Goal` (suffix when ordering matters: `Test Task 1`, `Test Task 2`).

Never use real family names, kid nicknames, or culturally-specific names in fixtures.

### When to inject the FakeClock

Service unit tests that depend on "now" inject `FakeClock` via the Nest test module:

```ts
const moduleRef = await Test.createTestingModule({
  providers: [MyService, { provide: CLOCK, useClass: FakeClock }],
}).compile();
const clock = moduleRef.get(FakeClock);
clock.set(new Date('2026-05-17T08:00:00Z'));
```

Pure engines don't need a clock — `now` is a parameter.

## End-to-end (Playwright)

Run against a full stack (API + web + Postgres), gated on `E2E_TEST_MODE=true` so timers don't race the harness. Suite lives in [apps/e2e/](../apps/e2e/).

```bash
npm run e2e          # headless
npm run e2e:ui       # Playwright UI runner
```

### Golden-path inventory

One spec file per user-visible flow ([apps/e2e/src/tests/](../apps/e2e/src/tests/)):

- `auth-admin-login.spec.ts` — admin login happy path
- `auth-tablet-enroll.spec.ts` — enrollment code → tablet token
- `tablet-task-complete.spec.ts` — Trackee marks routine done, earn posts
- `tablet-task-miss-fires.spec.ts` — clock advances past deadline, Miss fires, penalty posts
- `tablet-late-completion-undo.spec.ts` — late completion full-undo (ADR-0001)
- `pending-review-approve.spec.ts` / `pending-review-reject.spec.ts` — admin verification both directions
- `goal-flat-complete.spec.ts` / `goal-tiered-complete.spec.ts` — goal claim, earn posts
- `restriction-admin-block.spec.ts` / `restriction-admin-lift.spec.ts` — admin "Block now" + lift
- `cashout-tablet-to-admin.spec.ts` — tablet-initiated cash-out request → admin commit

### Fixtures

Per-test harness in [apps/e2e/src/fixtures/index.ts](../apps/e2e/src/fixtures/index.ts):

| Fixture | Provides |
| --- | --- |
| `api` | Authed HTTP client (`api.get/post/...`) |
| `floor` | DB reset + seed minimal floor: `Alice` admin, `Bob` Restrictable Trackee + Device, one goal category — runs before each test |
| `clock` | `{ get, set, advance, tick }` — drives `/_e2e/clock/*` and `/_e2e/scheduler/tick` |
| `enforcement` | Inspect/reset the fake router and PiHole HTTP clients (`router/log`, `pihole/log`) |
| `factories` | Server-side entity factories: `factory/trackee`, `factory/task`, `factory/goal`, `factory/adjust-balance` |

`page.on('dialog', d => d.accept())` is wired automatically — tests don't have to register a confirm handler for "lift restriction" / "reject cash-out" prompts.

### The clock + scheduler dance

Production timers are off in `E2E_TEST_MODE`. The test drives them explicitly:

```ts
await clock.set(new Date('2026-05-17T08:00:00Z'));
await api.post('/occurrences/{id}/complete', {});  // earn posts
await clock.advance(13 * 60 * 60 * 1000);          // 13 hours
await clock.tick('miss');                          // fire deadline tick
// assert Miss fired
```

`tick` options: `'all' | 'miss' | 'pending' | 'restrictions' | 'audible' | 'streak'` ([clock.ts](../apps/e2e/src/fixtures/clock.ts)). `'streak'` rolls over yesterday (relative to the fake clock); the others sweep at the current fake-clock instant.

### Page objects

Thin wrappers over locators in [apps/e2e/src/pages/](../apps/e2e/src/pages/). One per surface: tablet, tablet-enroll, login, admin-pending-review, admin-restrictions, admin-cashout.

### Fake HTTP clients

Both the router and PiHole adapters route to fakes in E2E mode ([apps/api/src/e2e/fake-router-http-client.ts](../apps/api/src/e2e/), [fake-pihole-http-client.ts](../apps/api/src/e2e/)). They record every call so tests can assert on enforcement intent without needing real network gear. Logs are queryable via `GET /_e2e/router/log` and `/_e2e/pihole/log`; reset via `POST /_e2e/router/reset` / `/_e2e/pihole/reset`.

### Testing scheduler idempotency

Any function wired to a recurring timer must be safe to call multiple times for the same input. The production rollover runs every minute while the household-local time is within the first 5 minutes after midnight — a window, so a minute-0 tick delayed by an event-loop stall or clock skew still rolls the day over ([tasks.module.ts](../apps/api/src/tasks/tasks.module.ts), `rolloverTimer`). That means the same calendar day is rolled over up to 5 times; without an idempotency guard, a qualifying day issues 5 bonuses instead of 1.

**Rule:** If a function is called from a `setInterval` window — i.e., the same logical event can trigger it more than once — write a test that calls it N times and asserts a once-only side-effect.

Pattern (pure engine layer — cheapest):
```ts
// Simulates the 5-minute window calling applyDay for an already-processed day.
const alreadyProcessed = { count: 4, lastQualifyingDay: '2026-05-15' };
const r = applyDay(alreadyProcessed, 'advance', ctx);
expect(r.bonusTxn).toBeUndefined();
```

Pattern (e2e — validates the full stack including DB persistence):
```ts
// Tick streak 5 times; assert exactly 1 bonus transaction.
for (let i = 0; i < 5; i++) {
  await api.post('/_e2e/scheduler/tick', { which: 'streak' });
}
const { transactions } = await api.get(...);
expect(transactions.filter(t => t.reason === 'daily routine streak')).toHaveLength(1);
```

See [daily-streak-rollover.spec.ts](../apps/e2e/src/tests/daily-streak-rollover.spec.ts) for the live example.

## Writing a new e2e test

1. Add a `*.spec.ts` under [apps/e2e/src/tests/](../apps/e2e/src/tests/) — Playwright auto-discovers.
2. Import `test, expect` from `../fixtures` (not `@playwright/test` directly) to inherit the harness.
3. Use `factories` for entities that the seed floor doesn't supply.
4. Drive time with `clock.set` / `clock.advance` + explicit `clock.tick(...)`. Never `await page.waitForTimeout(...)`.
5. Assert on a mix of UI state (page objects) and server state (REST queries via `api.get(...)`).

## Files to read

- Jest config: `"jest"` block in [apps/api/package.json](../apps/api/package.json)
- [apps/e2e/playwright.config.ts](../apps/e2e/playwright.config.ts)
- [apps/e2e/src/fixtures/index.ts](../apps/e2e/src/fixtures/index.ts) and siblings
- [apps/api/src/e2e/e2e.controller.ts](../apps/api/src/e2e/e2e.controller.ts) — the test-only HTTP surface
