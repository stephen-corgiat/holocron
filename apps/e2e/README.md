# Holocron e2e suite

Playwright-driven end-to-end tests that exercise the full stack: Vite (frontend), NestJS (backend), and Postgres.

## One-time setup

```sh
docker compose up -d postgres
npm install
npm --workspace apps/api run migration:run
npx playwright install chromium
```

## Run the suite

```sh
npm run e2e
```

Playwright boots `apps/api` (with `E2E_TEST_MODE=true`) and `apps/web` (Vite dev) automatically and tears them down on exit.

### Useful flags

- `npm run e2e:ui` — headed/inspector mode for debugging
- `npm run e2e -- src/tests/tablet-task-miss-fires.spec.ts` — single spec
- `npm run e2e -- --debug` — step-through with the Playwright inspector

## What the harness gives you

- `POST /_e2e/reset` — truncate all domain tables and seed Alice (admin) + Bob (Restrictable Trackee) + one device + one goal category. Returns admin/tablet JWTs.
- `POST /_e2e/clock/{set,advance}` — drive the injected `FakeClock`. All time-sensitive backend reads (Miss firing, restriction expiry, completion timestamps, cash-out decidedAt, etc.) honor it.
- `POST /_e2e/scheduler/tick` — fire `miss` / `pending` / `restrictions` / `audible` / `streak` schedulers on demand. The real `setInterval` loops are disabled in test mode.
- `GET /_e2e/{router,pihole}/log` — read the in-memory call log for the router + PiHole HTTP fakes. Both adapters never talk to a real service in test mode.
- `POST /_e2e/factory/{trackee,task,goal,adjust-balance}` — thin entity factories so each test sets up only what it needs.

The fixtures wrap all of the above so tests stay readable.

## Adding a new spec

1. Drop `your-flow.spec.ts` into `src/tests/`.
2. In the `beforeEach`, call `await reset(request)` from `src/fixtures/reset.ts` — that wipes the DB and returns the seeded ids + tokens.
3. Build any extra entities with the factories.
4. Use the Page Objects in `src/pages/` rather than raw selectors.
