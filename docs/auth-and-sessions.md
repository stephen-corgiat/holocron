# Auth & sessions

This document captures the design decisions behind authentication and
sessions.

## Two session shapes

There are exactly two kinds of sessions in the system, distinguished by a
`kind` claim on the JWT.

| Field            | `admin`                                         | `tablet`                                            |
| ---------------- | ----------------------------------------------- | --------------------------------------------------- |
| Created by       | `POST /auth/login` (username + password)        | `POST /auth/tablet/enroll` (one-time code)          |
| Bound to         | A specific `users.id`                            | The household, not a user                            |
| `is_admin` claim | `true`                                          | `false`                                             |
| TTL              | `JWT_ADMIN_TTL` (default `12h`)                  | `3650d` (effectively long-lived)                    |
| Refresh          | None — re-log on expiry                          | None — token persists until revoked                 |
| Storage          | `sessionStorage`                                | `localStorage`                                      |
| Surfaces         | `/login`, `/admin/*`                             | `/`, the tablet routine UI                          |

The household-tablet token is **not** bound to a single trackee. The active
trackee is selected by the tab strip in the UI; the server treats every
tablet-session request as authorized to act as any household trackee. It
never carries `is_admin`.

## Why these choices

### JWT bearer in `Authorization` header (not cookies)

- The same code path serves the admin browser and the tablet device. A
  bearer header works identically on both surfaces and on WebSocket
  connections (`socket.handshake.auth.token`); cookies would force the
  WebSocket to use the same origin / credentials story and add a CSRF
  consideration.
- Bearer tokens have **no CSRF surface** — a cross-origin request can't
  attach the header, so we don't ship CSRF middleware.
- The cost is XSS sensitivity: a successful XSS can read the token. The
  app is self-hosted on a LAN, served as a single SPA bundle with no
  third-party scripts, so the XSS attack surface is small. We accept the
  trade rather than carry the cookie + CSRF complexity.

### Admin token: 12h TTL, no refresh, sessionStorage

- 12 hours covers a working session without surviving overnight. Admin
  re-login is a one-trackee household event, not a high-frequency cost.
- No refresh token: the admin re-enters their password once a day. This is
  acceptable for a household app and removes a class of bugs (silent
  refresh, refresh-token rotation, refresh-token theft).
- `sessionStorage` clears on tab close. If an admin walks away from a
  borrowed laptop, closing the tab is a real logout — no need to remember
  to press the button.

### Tablet token: ~10y TTL, no refresh, localStorage

- The tablet is a dedicated household device. Re-prompting it for a
  password ever would defeat the entire "wall scoreboard" affordance.
- `localStorage` survives reboots and tab closes, which is what the device
  needs.
- We do not bother with rotation. The token is revoked operationally by
  re-enrolling the device (the new token is minted with a fresh `sub` and
  the old one becomes a bearer string that nobody can reach without
  physical access to the tablet's localStorage).

### Enrollment ceremony: short-lived code, redeem from tablet

- Admin signs in normally. From the admin home page they press
  `Generate code`. The server mints a `XXXX-XXXX` code (8 hex chars,
  hyphenated) with a 5-minute TTL and one-shot semantics. The code is held
  in-memory; it is small + short-lived enough that an API restart simply
  invalidates the in-flight enrollment, and the admin generates a new one.
- Admin walks to the tablet, opens the app, lands on `/tablet/enroll`,
  types the code. The tablet trades the code for the long-lived
  household-tablet JWT and stores it in `localStorage`.
- This avoids displaying the long JWT itself on screen, supports a quick
  enrollment without QR-code tooling, and keeps the cryptographic
  material on the server side.

### Bootstrap admin

- Migrations create an empty `users` table. The first admin is created at
  API boot from `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD`
  / `BOOTSTRAP_ADMIN_DISPLAY_NAME`, but only when no admin exists yet.
- After the first admin signs in once, those env vars become inert — the
  app does not re-create them on subsequent restarts.

### WebSocket auth

The realtime gateway requires a valid session JWT on the handshake
(`socket.handshake.auth.token`). Sockets without a token, or with an
invalid one, receive an `auth_error` event and are immediately
disconnected. The same `AuthService.verifyToken` path is used for HTTP
and WS — there is no separate WS token format.

## Endpoint surface

| Method | Path                            | Auth                       | Notes                                           |
| ------ | ------------------------------- | -------------------------- | ----------------------------------------------- |
| POST   | `/auth/login`                   | none                       | Admin sign-in. Returns `{ token, user }`.       |
| POST   | `/auth/tablet/enrollment-code`  | admin only                 | Mints a one-time enrollment code.               |
| POST   | `/auth/tablet/enroll`           | none                       | Tablet redeems a code → tablet JWT.             |
| GET    | `/auth/whoami`                  | any valid session          | Returns the active session's capabilities.      |

All endpoints sit under the global `/api/...` prefix at the SPA layer
(stripped by the dev proxy + nginx so the API itself sees `/auth/...`).

## What's deliberately not built yet

- **Per-trackee tablet auth.** The household-tablet session impersonates
  any trackee; trackee selection lives in the UI tab strip. There is no
  "switch user" auth ceremony.
- **Token rotation, blocklists, refresh tokens.** Out of scope for v1; the
  app is single-tenant and self-hosted.
- **Rate limiting on `/auth/login`.** Trivially adding a NestJS throttler
  is an option; not load-bearing on a LAN-only deploy.
- **Password reset flow.** Admin password is operationally reset by
  editing the row directly or rotating the bootstrap env vars and
  restarting. A first-class flow can come later if households accumulate
  enough admins to need one.
