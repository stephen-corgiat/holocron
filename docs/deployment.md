# Self-hosting

How to run Holocron on a LAN host from the published images, keep it upgraded, and back it up. For a development setup from source, see [development.md](development.md).

CI publishes pre-built images to GHCR, so a host only needs Docker with the Compose plugin, a `compose.yml` and a `.env`. You don't need a source checkout or a Node toolchain.

## 1. Pick an image tag

Every build of `master` is published as:

```
ghcr.io/stephen-corgiat/holocron/api:latest
ghcr.io/stephen-corgiat/holocron/web:latest
```

Pin a specific build with its `sha-<short>` tag (e.g. `sha-91ec354`), or a release with its version tag (e.g. `1.2.3`), by setting `IMAGE_TAG` in `.env`.

## 2. Create `.env`

In an empty directory on the host, download [.env.example](../.env.example) as `.env`:

```sh
curl -fsSL -o .env https://raw.githubusercontent.com/stephen-corgiat/holocron/master/.env.example
```

Then fill in at least:

- `POSTGRES_PASSWORD` — a strong random string.
- `JWT_SECRET` — generate with `openssl rand -hex 32`.
- `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` — the first admin login. Change the password from the admin UI after first sign-in.
- `WEB_ORIGIN` — the URL browsers use to reach the web service. CORS and the WebSocket handshake check it.
- Restriction enforcement: `ROUTER_BASE_URL` + `ROUTER_BEARER_TOKEN` (router HTTP daemon) and `PIHOLE_BASE_URL` + `PIHOLE_API_PASSWORD` (Pi-hole). See [engines/restrictions.md](engines/restrictions.md). To try Holocron without either, set `FAKE_ENFORCEMENT=true`. Nothing is blocked in that mode.
- Optional: the `HA_*` / `SCRYPTED_*` variables for the home surface. See [home-surface.md](home-surface.md).

## 3. Get `compose.yml`

[deploy/compose.yml](../deploy/compose.yml) runs Postgres, a one-shot `migrate` service, the API and the web app from the published images. Download it next to your `.env`:

```sh
curl -fsSL -o compose.yml https://raw.githubusercontent.com/stephen-corgiat/holocron/master/deploy/compose.yml
```

It reads `IMAGE_TAG`, `WEB_PORT` (default `8080`), `API_PORT` (default `3000`) and the Postgres settings from `.env`.

## 4. Start it

```sh
docker compose pull
docker compose up -d
docker compose logs migrate          # migrations applied cleanly
docker compose logs -f api           # first admin bootstrapped
curl http://localhost:8080/healthz   # {"status":"ok","db":"ok"}
```

`migrate` is a one-shot service: it runs the TypeORM migrations from the API image and exits, and `api` waits for it (`service_completed_successfully`). On first boot the API creates the first admin from `BOOTSTRAP_ADMIN_*`. Those variables are ignored once any admin exists.

Open `http://<host>:8080/login` in a browser to reach the admin console. To set up the wall tablet, generate an enrollment code in the admin console and redeem it on the tablet at `/tablet/enroll` ([auth-and-sessions.md](auth-and-sessions.md)).

### Optional: load the starter household

On a fresh database, the `seed` script loads a starter household (four example users, presence schedules, goal categories, a goal catalog and daily routines) from JSON files baked into the image:

```sh
docker compose run --rm api node dist/scripts/seed.js
```

Run it **once**, after the first `up -d`. It upserts by name and keeps point balances, completions and occurrences. **Re-running it reverts admin edits to the fields it seeds**, such as display names, point values, presence schedules and ladder rungs, so keep it out of your upgrade flow.

`--reset-occurrences` also wipes today's materialized occurrences (e.g. after changing the household time zone), so they re-materialize on the next tick:

```sh
docker compose run --rm api node dist/scripts/seed.js --reset-occurrences
```

## 5. Upgrade

```sh
docker compose pull && docker compose up -d
```

`latest` moves with every `master` build. `migrate` runs on every `up` and skips migrations that are already applied. Migrations are forward-only, so take a backup before upgrading. To go back to an image older than a schema change, you have to restore that backup.

## Backups

Dump the database in `pg_dump` custom format (compressed, and restorable table by table):

```sh
mkdir -p backups
docker compose exec -T postgres sh -c \
  'pg_dump -Fc -Z 9 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "backups/holocron-$(date +%Y%m%d-%H%M%S).dump"
```

The credentials come from the container's own environment, so nothing appears in the host's process list. Schedule that line with cron, and prune old dumps (e.g. `find backups -name 'holocron-*.dump' -mtime +14 -delete`).

Restore. This is destructive, so take a fresh backup first:

```sh
docker compose exec -T postgres sh -c \
  'pg_restore --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backups/<file>.dump
```

To check a dump without touching the live database, restore it into a throwaway container:

```sh
docker run -d --rm --name restore-test -e POSTGRES_PASSWORD=x -e POSTGRES_DB=t postgres:16-alpine
docker exec -i restore-test pg_restore --no-owner -U postgres -d t < backups/<file>.dump
docker exec restore-test psql -U postgres -d t -c 'select count(*) from users'
docker stop restore-test
```

Backups on the same host as the database won't survive losing the host. Copy them off-host too.

## CI and image publishing

```
pull request ──► ci.yml: unit tests (api Jest + web Vitest)

push to master,  ──► docker-publish.yml
v* tag, or manual      test            (calls ci.yml)
                       build           api + web images → GHCR (sha-<short>, latest, version)
                       trigger-deploy  (optional, master only; see below)
```

- [ci.yml](../.github/workflows/ci.yml) runs the unit tests only. The e2e suite needs Postgres and Chromium, so run it locally ([testing.md](testing.md)).
- [docker-publish.yml](../.github/workflows/docker-publish.yml) builds images only after the tests pass. It tags them `sha-<short>` and `latest`, plus the version for `v*` tags.
- [ghcr-cleanup.yml](../.github/workflows/ghcr-cleanup.yml) runs daily and keeps the 5 most recent tagged versions of each image, deleting untagged ones.

## Continuous deployment (optional)

The `trigger-deploy` job hands each `master` build to a deploy workflow in **another repository**, typically a private one with a self-hosted runner on your docker host. Self-hosted runners must never be attached to a public repo, because a fork's pull request could run code on them. Keeping the runner in a private repo avoids that.

To enable it on your fork or mirror:

1. In the deploy repo, add a workflow named `deploy.yml` with a `workflow_dispatch` input `image_tag`, running on your self-hosted runner. It should run `docker compose pull && docker compose up -d` with `IMAGE_TAG` set to that input.
2. Create a fine-grained token with access to **only** the deploy repo and **Actions: Read and write** permission.
3. In this repo, set the secret and the variable:

   ```sh
   gh secret set DEPLOY_DISPATCH_TOKEN          # paste the token
   gh variable set DEPLOY_REPO --body <owner>/<deploy-repo>
   ```

With `DEPLOY_REPO` unset, the job is skipped.
