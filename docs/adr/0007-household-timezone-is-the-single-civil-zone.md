# The household time zone is the single civil-time zone; storage stays UTC

Every wall-clock, calendar-day, and time-of-day decision in Holocron resolves through **one** setting — the household `time_zone` (`household_settings.time_zone`, an IANA name, default `America/Los_Angeles`). All timestamps are stored in UTC (`timestamptz`); the household zone is applied only when projecting an instant to a civil value (hour, day, weekday, `HH:MM`) or when interpreting a wall-clock the admin typed.

## Why

The app previously assumed the **runtime** zone equalled the household zone. Two inconsistent conventions had grown up:

- **runtime-local** (`Date#getHours/getDate/setHours`) across tasks, daily-streak, audible-warning, presence-reconciliation, recurrence anchoring, and the day-rollover scheduler; and
- **UTC** (`Date#getUTC*`) in the presence resolver.

Neither is correct when the API process, the admin's browser, or the wall tablet sits in a zone different from the household's. The only thing that kept it working was coincidence (e2e pins both `TZ=UTC` and household `UTC`; dev machines happened to match the LA default). The visible symptom was reminders rendering at the wrong time and falling under the wrong routine section (a 11:45 reminder showing as 04:45 under Morning on a UTC household viewed from a UTC-7 machine).

## The rule

- **Backend**: a small set of helpers in [`clock/tz.ts`](../../apps/api/src/clock/tz.ts) (`ymdInTz`, `utcInstantFor`, `startOfDayInTz`/`endOfDayInTz`, `addDaysInTz`, `isoDateInTz`, `dayOfWeekInTz`, `hourInTz`/`minutesOfDayInTz`, `wallClockInTz`) own *all* civil-time math. Every service that does day/time work fetches the household zone once (the `private tz()` accessor, defaulting to `DEFAULT_TIME_ZONE` when settings aren't wired) and threads it into those helpers. The dangerous runtime-local fallbacks were removed.
- **Frontend**: the mirror helpers in [`lib/datetime.ts`](../../apps/web/src/lib/datetime.ts) project via `Intl.DateTimeFormat({ timeZone })`. A `SettingsProvider` fetches the zone (`GET /settings/public`, readable by the tablet token) and exposes `useHouseholdTimeZone()`; every formatter renders in it, including the tablet's own clock and greeting. Wall-clock **inputs** (windowed `window_start/end`, ledger date filters) are interpreted in the household zone via `utcInstantInTz`.
- **Recurrence engine** stays calendar-field-agnostic; callers feed it a *civil-day token* built from the household `Y/M/D` (`civilDayToken`) so "does this fire today?" is evaluated against the household day.
- **Per-day uniqueness**: occurrences carry an app-maintained `local_day` (the household civil day of `scheduled_at`); the unique index keys on it instead of the old `(scheduled_at AT TIME ZONE 'UTC')::date`.

## Consequences

- Changing the household zone re-projects all displayed times and shifts day boundaries for streaks, goal limit windows, miss deadlines, audible warnings, and presence — including retroactively, because presence is reconciled against the current schedule (ADR-0003/0005). This is intended; it's surfaced to the admin in the settings copy.
- Correctness no longer depends on the process `TZ`. The API unit suite passes identically under `TZ=UTC`, `America/New_York`, `Asia/Tokyo`, and `Pacific/Kiritimati` — run a non-UTC `TZ` in CI to keep it that way.
- DST is handled by the offset-probe in `utcInstantFor`; spring-forward/fall-back day arithmetic is covered by tests.

A future multi-zone-per-household need would break this single-zone assumption and require per-Trackee or per-device zones; that is explicitly out of scope.
