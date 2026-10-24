# Local development

The recommended loop is **API + web on host, Postgres in Docker**. Fast reload, easy debugging, and `Clock` injection lets you exercise time-based logic without sleeping. For deployment-image testing, full `docker compose up` works against the same `docker-compose.yml` ([../docker-compose.yml](../docker-compose.yml)).

See also: [deployment.md](deployment.md) (self-hosting from the published images), [testing.md](testing.md), [architecture/scheduling.md](architecture/scheduling.md).

## Prerequisites

- Node 24.9+ (`engines.node` in [../package.json](../package.json); the API's Jest suite loads the ESM-only NestJS 12 packages via `require(esm)`). The Docker images and CI use the same major.
- Docker (for Postgres)
- Optional: PiHole + EdgeRouter on the LAN to exercise enforcement adapters end-to-end. Without them, set `FAKE_ENFORCEMENT=true` in `.env` to use the in-memory fakes (the API otherwise refuses to start when PiHole is unreachable).

## Bring it up

```bash
npm install                              # workspace install at repo root
docker compose up -d postgres            # Postgres on :5432
cp .env.example .env                     # then edit JWT_SECRET, BOOTSTRAP_ADMIN_*
npm --workspace apps/api run migration:run
npm run dev                              # api on :3000, web on :5173 (via Vite)
```

The Vite dev server proxies `/api` and `/socket.io` to the backend.

First login: `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` from `.env`. The seed runs only when `users` is empty — rotate the password from the admin UI after first login.

## Optional: load the starter household

```bash
npm run seed
```

Upsert-by-name from JSON files baked into [apps/api/src/scripts/seed-data/](../apps/api/src/scripts/seed-data/) (users, categories, goals, tasks). Safe to re-run; **re-running reverts admin edits to seed-tracked fields** (display names, point values, presence schedules, ladder rungs).

Pass `--reset-occurrences` to wipe today's materialized occurrences (e.g. after changing the household time zone):

```bash
npm --workspace apps/api run seed -- --reset-occurrences
```

## Env vars

All consumed via `@nestjs/config`. Source of truth: [.env.example](../.env.example).

| Var | Required? | Purpose |
| --- | --- | --- |
| `NODE_ENV` | no | `development` / `production` |
| `API_PORT` | no (default 3000) | HTTP listener |
| `POSTGRES_HOST` / `_PORT` / `_DB` / `_USER` / `_PASSWORD` | yes | DB connection |
| `WEB_ORIGIN` | yes | CORS allow list + Socket.io handshake check |
| `JWT_SECRET` | yes | ≥16 chars; sign admin and tablet JWTs |
| `JWT_ADMIN_TTL` | no (12h) | Admin session lifetime |
| `BOOTSTRAP_ADMIN_USERNAME` / `_PASSWORD` / `_DISPLAY_NAME` | yes on fresh DB | Seeded admin |
| `ROUTER_BASE_URL` / `ROUTER_BEARER_TOKEN` | yes | EdgeRouter HTTP daemon (internet scope) — startup fails if missing |
| `PIHOLE_BASE_URL` / `PIHOLE_API_PASSWORD` | yes | PiHole REST API (entertainment + games) — startup fails if missing or group lookup fails |
| `PIHOLE_GAMES_GROUP_NAME` | no | Default `blocked-games-dynamic`; must exist on PiHole |
| `PIHOLE_STREAMING_GROUP_NAME` | no | Default `blocked-streaming-dynamic`; must exist on PiHole |
| `FAKE_ENFORCEMENT` | dev only | `true` swaps router + PiHole transports for in-memory fakes (no LAN hardware needed); nothing is enforced |
| `E2E_TEST_MODE` | tests only | Toggles `FakeClock`, disables timers, mounts `/_e2e/*` controller |

Code references:
- Auth: [apps/api/src/auth/auth.service.ts](../apps/api/src/auth/auth.service.ts)
- Router: [restrictions.module.ts:75-95](../apps/api/src/restrictions/restrictions.module.ts#L75)
- PiHole: [restrictions.module.ts:103-141](../apps/api/src/restrictions/restrictions.module.ts#L103)

## Common workflows

### Add a migration

```bash
# 1. Edit / add entity.ts files in apps/api/src
# 2. Generate (auto-diff vs. running DB):
npm run migration:generate -- src/database/migrations/<unix-ms>-<slug>
# 3. Or hand-write (data-only):
npm run migration:create -- src/database/migrations/<unix-ms>-<slug>
# 4. Apply locally:
npm run migration:run
```

The migration filename's leading timestamp determines order. Migrations are forward-only — `npm run migration:revert` exists for local recovery but is not part of any deploy path.

### Switch to FakeClock manually (e.g., for a one-off debug session)

```bash
E2E_TEST_MODE=true npm --workspace apps/api run start:dev
# Then drive the clock via the e2e endpoints:
curl -X POST http://localhost:3000/_e2e/clock/set -H 'content-type: application/json' \
     -d '{"to":"2026-05-17T08:00:00Z"}'
curl -X POST http://localhost:3000/_e2e/scheduler/tick -d '{"which":"miss"}'
```

### Inspect the ledger

```bash
docker compose exec postgres psql -U holocron -d holocron \
  -c "SELECT user_id, kind, amount, reason, occurrence_id, txn_group_id, created_at
       FROM transactions
       ORDER BY created_at DESC LIMIT 50;"
```

### Reset the local DB

```bash
docker compose down -v && docker compose up -d postgres && \
npm --workspace apps/api run migration:run && npm run seed
```

## Frontend

Vite dev server at `:5173`. The tablet surface is `/tablet`; admin browser is `/admin`. After enrolling a tablet (admin generates a 5-min code at `/admin`, redeem at `/tablet/enroll`), the tablet token persists across reloads ([../apps/web/src/auth/AuthProvider.tsx](../apps/web/src/auth/AuthProvider.tsx)).

To exercise a specific Trackee on a fresh tablet, run `npm run seed` for the starter household and use the active-trackee tab strip.

## Full-stack via Docker (deploy image rehearsal)

```bash
docker compose up --build
# api → http://localhost:3000
# web → http://localhost:8080
```

This builds the deploy images locally. The repo also publishes `:latest` GHCR images on every master merge and tag — see [deployment.md](deployment.md) for the operator-facing deploy flow (which uses GHCR images and a `migrate` one-shot compose service that the dev compose file omits).

## Troubleshooting

- **API fails at startup with `ROUTER_BASE_URL must be set`** — set both router env vars in `.env`. They can point at anything during local dev; the adapter just needs to construct.
- **PiHole adapter throws `unknown group` at startup** — the configured `PIHOLE_GAMES_GROUP_NAME` / `PIHOLE_STREAMING_GROUP_NAME` (or their defaults) must exist on the PiHole instance. Create them in the PiHole UI or override the names.
- **`enforcement_log` rows say `skipped`** — the Trackee has no Device of the address kind the scope's backend needs (IP for router, MAC for PiHole). Add a Device on the admin Trackees page.
- **WebSocket says `disconnected`** — `WEB_ORIGIN` must match the URL the browser uses; CORS + handshake check.

## Files to read

- [deployment.md](deployment.md) — self-hosting
- [../package.json](../package.json), [../apps/api/package.json](../apps/api/package.json)
- [../docker-compose.yml](../docker-compose.yml)
- [../.env.example](../.env.example)
- [../apps/api/src/scripts/seed.ts](../apps/api/src/scripts/seed.ts)
