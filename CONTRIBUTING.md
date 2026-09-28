# Contributing

Thanks for helping. Bug reports, fixes and features are all welcome. For anything larger than a small fix, open an issue first so we can agree on the approach.

## Set up

You need Node 24.9+ (the app itself runs on 22.12+, but the API's Jest suite needs `require(esm)`), npm 10+, and Docker for Postgres.

```sh
npm ci
cp .env.example .env              # set JWT_SECRET and BOOTSTRAP_ADMIN_*; add FAKE_ENFORCEMENT=true
docker compose up -d postgres     # Postgres on :5432
npm run migration:run
npm run dev                       # API on :3000, web on :5173
npm run seed                      # optional: the starter household
```

[docs/development.md](docs/development.md) covers environment variables, migrations, the fake clock and troubleshooting.

## Build and test

```sh
npm test                          # API (Jest) + web (Vitest) unit tests
npm run build                     # type-checks and builds both apps
npm run e2e                       # Playwright end-to-end suite
```

CI runs `npm test` on every pull request. Run `npm run build` too, because the web build is the type check.

The e2e suite boots the API and the Vite dev server itself, but it **truncates every domain table** in the database named in your `.env` before each test. Point it at a throwaway database, not one with data you care about. [docs/testing.md](docs/testing.md) explains the harness: the fake clock, scheduler ticks, router, Pi-hole and Home Assistant fakes, and the page objects.

Name test fixtures `Alice` (Admin) and `Bob` (Restrictable Trackee), adding `Carol` and `Dave` when you need more people, and `Test Household`, `Test Task` and `Test Goal` for the rest. Don't use real names.

## Layout

| Path | What's there |
|---|---|
| `apps/api/` | NestJS API. One folder per domain module under `src/`: entity, service, controller, `dto.ts` and specs. |
| `apps/api/src/database/migrations/` | TypeORM migrations, applied in timestamp order. Forward-only. |
| `apps/api/src/scripts/` | The `seed` script and its JSON data. |
| `apps/web/` | React app: the wall-tablet surface (`pages/TabletPage.tsx`, `tablet/`) and the admin console (`pages/Admin*Page.tsx`, `admin/`). |
| `apps/e2e/` | Playwright suite, fixtures and page objects, plus the screenshot storyboard in `src/screenshots/`. |
| `deploy/compose.yml` | Production stack, run from the published images. |
| `docker-compose.yml` | Development stack, built from source. |
| `scripts/screenshots/` | Builds the README GIF and crops its stills. |
| `GLOSSARY.md` | Domain vocabulary. Code, tests and docs use these terms exactly. |
| `docs/` | Architecture, per-engine reference, ADRs (`docs/adr/`), self-hosting. |

[CLAUDE.md](CLAUDE.md) maps each domain concept to its code, and is a quick index for people as well as agents.

## Seed data

`apps/api/src/scripts/seed-data/*.json` describes a made-up household (Alice, Bob, Chad and Debbie) with a goal catalog and daily routines. The seed script upserts it by name. [seed-data.spec.ts](apps/api/src/scripts/seed-data.spec.ts) checks the files against each other without a database:

- every routine names known Trackees and a known ladder;
- every goal names a known category;
- grids have the right shape;
- example devices use only documentation addresses (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, MACs `00:00:5e:00:53:xx`).

Keep real names and real network details out of it.

## Screenshots and the README GIF

The README's GIF and stills come from a Playwright storyboard ([hero.spec.ts](apps/e2e/src/screenshots/hero.spec.ts)) that runs against a freshly seeded database. You need `ffmpeg` and Chromium (`npx playwright install chromium`), and Postgres running. Stop any local dev servers first, because the run binds ports 3000 and 5173.

```sh
npm run screenshots               # asks before dropping and recreating holocron_screenshots
```

That writes `docs/screenshots/hero.gif`, one still per beat in `docs/screenshots/shots/`, and the cropped README stills in `docs/screenshots/readme/`.

- **New beat:** add it to the storyboard and to `HOLD_SECONDS` in [build-gif.mjs](scripts/screenshots/build-gif.mjs).
- **New crop:** add it to `CROPS` in [crop-readme.mjs](scripts/screenshots/crop-readme.mjs), then run `node scripts/screenshots/crop-readme.mjs`. This needs only ffmpeg.

The home-surface stills (`shots/home-integration-*.png`) are captured by hand from a real installation, not by the storyboard. Look at every image before you commit it.

## Pull requests

- Keep each PR to one change, with tests.
- Use the glossary's terms in code, tests and commit messages.
- Record a decision that's hard to reverse as an ADR in `docs/adr/`.
- Schema changes need a new migration. Never edit one that has already shipped.
- Add yourself to [CONTRIBUTORS.md](CONTRIBUTORS.md) in your first PR.

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
