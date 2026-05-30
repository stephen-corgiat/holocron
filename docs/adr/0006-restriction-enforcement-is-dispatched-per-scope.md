# Restriction enforcement is dispatched per scope to one of two backends

The original v1 enforcement design routed all three scopes (`internet`, `entertainment`, `games`) through a single EdgeRouter HTTP adapter that maintained one ipset per scope and blocked by IP. That works for the `internet` scope, where blocking all of a Trackee's IPs at the router cuts off network access wholesale. It works poorly for `entertainment` and `games`, where the goal is to block specific *services* (streaming, gaming) without taking the whole network offline — a problem that lives at the DNS layer, not the routing layer.

We split enforcement by scope:

- **`internet` → router**. The EdgeRouter HTTP adapter (`/{type}/add` and `/{type}/del` with comma-separated `ip=<csv>`) writes a single batched call per Trackee per state change. The router's per-scope ipsets gate outbound traffic by IP.
- **`entertainment` and `games` → PiHole**. The PiHole REST API adapter assigns each of a Trackee's MAC-addressed Devices to a pre-existing PiHole group (`blocked-streaming-dynamic`, `blocked-games-dynamic`) whose blocklists sinkhole the relevant domains. Unblocking removes the group from the client.

A thin dispatcher (`RestrictionEnforcementService`) is the only enforcement port `RestrictionsService` knows about; the scope-to-backend mapping lives there. Adding a third backend in the future means registering an implementation of `RestrictionBackend` and editing the dispatcher's map — no churn in the domain code.

Three implementation choices worth recording:

- **PiHole group assignment is read-modify-write.** The PiHole API replaces the entire `groups[]` array on PUT, so we GET the current client first, mutate only the group we own, and PUT it back. This lets us coexist with any manual PiHole admin edits — we never stomp groups we didn't put there. Idempotent: we skip the PUT entirely when the desired state already matches.
- **Group IDs are resolved by name at boot.** PiHole returns group IDs as integers; we look them up once from `/api/groups` at module init and cache the name → ID map. Missing groups fail startup, so a misconfigured PiHole can never silently no-op every games/entertainment restriction.
- **Router calls are batched.** The new router API takes a comma-separated IP list, so we make one HTTP call per Trackee per state change instead of fanning out per IP. The enforcement_log row is one-per-call, with the full IP list in `target_address`.

Devices without the address kind a backend needs (no IP for router, no MAC for PiHole) are recorded as `result='skipped'` rows in `enforcement_log`; the admin UI surfaces these as a "NOT ENFORCED" badge on the active-restriction row so the admin can spot under-enrolled Trackees without digging through logs.

Existing router-side ipset entries for `games`/`entertainment` from before this split are left as-is; the next state change on each Restriction naturally migrates it to the new backend via the dispatcher. No one-shot data migration script.
