# Holocron: Household Routine & Reward App

A self-hosted, single-family wall-tablet app for daily routines, points, goals, and router-level restrictions.

## Index

Start here to locate the right document:

- **Domain language** — [GLOSSARY.md](GLOSSARY.md): vocabulary (Trackee, Miss, Tier, Restriction, Cause, Presence, etc.) and relationships. Source of truth for terminology.
- **Architecture & engines** — [docs/](docs/): system overview, data model, realtime gateway, scheduling, plus per-engine mechanism reference (Miss detection, ledger, presence reconciliation, restriction merge, etc.).
- **Architectural decisions** — [docs/adr/](docs/adr/): seven ADRs covering Late completion (0001), Pending review (0002), Presence derivation (0003), Restriction lift orthogonality (0004), Presence schedule non-versioning (0005), Restriction enforcement dispatch (0006), Household timezone as the single civil zone (0007).
- **Feature design notes** — [docs/auth-and-sessions.md](docs/auth-and-sessions.md): JWT and household-tablet session design.
- **Agent guides** — [docs/agents/domain.md](docs/agents/domain.md): how to use the glossary and ADRs.
- **Local development & testing** — [docs/development.md](docs/development.md), [docs/testing.md](docs/testing.md).
- **Self-hosting, CI & backups** — [docs/deployment.md](docs/deployment.md): Docker Compose install from published images, unit-test CI, image publishing, database backups.
- **Contributing** — [CONTRIBUTING.md](CONTRIBUTING.md): build/test commands, repo layout, seed data, screenshots.
- **Apps** — [apps/api/](apps/api/) (backend), [apps/web/](apps/web/) (frontend). See [Module map](#module-map) below to jump straight to the code for a given domain concept.

## Module map

Backend modules live under [apps/api/src/](apps/api/src/) as NestJS feature modules. Each folder follows the convention `*.module.ts` (wiring), `*.controller.ts` (HTTP), `*.service.ts` (logic), `*.entity.ts` (TypeORM), `dto.ts` (request/response shapes), `*.spec.ts` (unit tests). Services publish realtime events on the shared `RealtimeBus` ([realtime/](apps/api/src/realtime/)), which the Socket.IO gateway fans out to clients.

Domain concept → code:

- **Trackee / Admin / Restrictable Trackee** ([GLOSSARY.md#roles--accounts](GLOSSARY.md#roles--accounts)) — [apps/api/src/users/](apps/api/src/users/) (entity, service, bootstrap-admin, slug). Admin/JWT guards in [apps/api/src/auth/](apps/api/src/auth/).
- **Household-tablet session** — auth flow in [apps/api/src/auth/](apps/api/src/auth/) (see [docs/auth-and-sessions.md](docs/auth-and-sessions.md)); web side in [apps/web/src/auth/](apps/web/src/auth/) and [TabletEnrollPage.tsx](apps/web/src/pages/TabletEnrollPage.tsx) / [TabletPage.tsx](apps/web/src/pages/TabletPage.tsx).
- **Task, Occurrence, Miss, Escalation ladder, Tier** — [apps/api/src/tasks/](apps/api/src/tasks/). Key files: [task.entity.ts](apps/api/src/tasks/task.entity.ts), [occurrence.entity.ts](apps/api/src/tasks/occurrence.entity.ts), [ladder-position.entity.ts](apps/api/src/tasks/ladder-position.entity.ts), [miss.service.ts](apps/api/src/tasks/miss.service.ts), [resolution/](apps/api/src/tasks/resolution/) (Miss engine, escalation ladder, Occurrence resolution), [recurrence/](apps/api/src/tasks/recurrence/), [occurrence-actions.service.ts](apps/api/src/tasks/occurrence-actions.service.ts) (Excused / Deferred / Late completion).
- **Daily routine streak** — [daily-streak.entity.ts](apps/api/src/tasks/daily-streak.entity.ts), [daily-streak.service.ts](apps/api/src/tasks/daily-streak.service.ts). **Clean streak** counters live alongside [ladder-position.entity.ts](apps/api/src/tasks/ladder-position.entity.ts).
- **Pending review** (ADR-0002) — [apps/api/src/pending-review/](apps/api/src/pending-review/).
- **Goal, Tiered goal, Goal completion, completion limits** — [apps/api/src/goals/](apps/api/src/goals/). Limit-window math in [goal-limit-engine.ts](apps/api/src/goals/goal-limit-engine.ts); categories in [categories.service.ts](apps/api/src/goals/categories.service.ts).
- **Transaction / Adjust Balance / Cash-out** — [apps/api/src/transactions/](apps/api/src/transactions/).
- **Presence schedule / N-week pattern grid / Presence-suppressed** (ADR-0003, ADR-0005) — [apps/api/src/presence/](apps/api/src/presence/). Derivation logic in [presence-resolver.ts](apps/api/src/presence/presence-resolver.ts). Mechanism reference: [docs/engines/presence.md](docs/engines/presence.md).
- **Restriction / Cause / Lift mechanism** (ADR-0004, ADR-0006) — [apps/api/src/restrictions/](apps/api/src/restrictions/). Merge engine in [restriction-merge.ts](apps/api/src/restrictions/restriction-merge.ts); scope-to-backend dispatcher in [restriction-enforcement.service.ts](apps/api/src/restrictions/restriction-enforcement.service.ts). Mechanism reference: [docs/engines/restrictions.md](docs/engines/restrictions.md). Env var setup in [docs/development.md](docs/development.md).
- **Device** — per-Trackee enrolled devices with `ip_address` / `mac_address`. [device.entity.ts](apps/api/src/users/device.entity.ts), [devices.service.ts](apps/api/src/users/devices.service.ts); edited inline on the admin Trackees screen.
- **Audible warning, household-wide settings** — [apps/api/src/household-settings/](apps/api/src/household-settings/).
- **Database / migrations** — [apps/api/src/database/](apps/api/src/database/); TypeORM data source in [data-source.ts](apps/api/src/database/data-source.ts), migrations under [database/migrations/](apps/api/src/database/migrations/).
- **Realtime push (WebSocket)** — [apps/api/src/realtime/](apps/api/src/realtime/); web consumer in [useSocket.ts](apps/web/src/hooks/useSocket.ts).

Frontend ([apps/web/src/](apps/web/src/)) splits by surface: the wall-tablet surface is [TabletPage.tsx](apps/web/src/pages/TabletPage.tsx); admin-browser surfaces are the `Admin*Page.tsx` files under [pages/](apps/web/src/pages/), shelled by [AdminShell.tsx](apps/web/src/admin/AdminShell.tsx). Page names track the domain — [AdminPresencePage.tsx](apps/web/src/pages/AdminPresencePage.tsx) edits the Presence schedule, [AdminPendingReviewPage.tsx](apps/web/src/pages/AdminPendingReviewPage.tsx) handles approvals, etc.

When in doubt: grep [GLOSSARY.md](GLOSSARY.md) for the term, then grep [apps/api/src/](apps/api/src/) for the same term — entity and service naming tracks domain vocabulary directly.

## Testing conventions

Use generic, neutral names in unit and e2e tests so fixtures don't drift into real household details and so domain roles stay obvious at a glance:

- **Trackees**: `Alice` (Admin, non-Restrictable) and `Bob` (non-Admin, Restrictable Trackee). Add `Carol`, `Dave` if you need a third or fourth.
- **Household**: `Test Household`.
- **Tasks / Goals**: `Test Task`, `Test Goal` (suffix with a number when ordering matters: `Test Task 1`, `Test Task 2`).

Don't use real family names, kid nicknames, or culturally-specific names in fixtures. If a test needs to assert role behavior, prefer the canonical pairing above so the reader can infer the role from the name alone.

### Running tests

Unit tests (per workspace, fast, no external services):

```sh
npm test                                   # api + web unit tests
npm --workspace apps/api run test           # backend (Jest) only
npm --workspace apps/web run test           # frontend (Vitest) only
npx jest src/clock/tz.spec.ts               # single backend spec (run from apps/api/)
npx vitest run apps/web/src/lib/datetime.test.ts   # single frontend spec (run from repo root)
```

End-to-end tests ([apps/e2e/](apps/e2e/)) drive the full stack — Playwright boots `apps/api` (with `E2E_TEST_MODE=true`) and the `apps/web` Vite dev server automatically, so the only prerequisite is Postgres + migrations + the Chromium browser:

```sh
docker compose up -d postgres               # one-time: start the DB
npm --workspace apps/api run migration:run  # one-time: apply migrations
npx playwright install chromium             # one-time: fetch the browser

npm run e2e                                  # run the whole suite (headless)
npm run e2e:ui                               # Playwright UI runner (debugging)
npm run e2e -- src/tests/<flow>.spec.ts      # run a single spec
```

Because `E2E_TEST_MODE` disables production timers, e2e specs drive the clock and schedulers explicitly via the `clock` / scheduler fixtures — never `setTimeout` or wall-clock waits. See [docs/testing.md](docs/testing.md) for the harness (`reset`, `clock`, scheduler `tick`, router/PiHole fakes, Page Objects) and [apps/e2e/README.md](apps/e2e/README.md) for setup details.

## Agent skills

### GitHub PRs

Use the `gh` CLI to create PRs.

### Domain docs

Single-context layout: one `GLOSSARY.md` + `docs/adr/` at the repo root. See [docs/agents/domain.md](docs/agents/domain.md).
