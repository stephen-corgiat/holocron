# Home surface — Home Assistant + Scrypted cameras

The home surface is an **optional** wall-tablet panel that exposes a small,
whitelist-constrained slice of a Home Assistant instance plus a strip of
Scrypted camera tiles. It renders as a docked status strip on the tablet and a
full **Home** view, with a **doorbell glance** that pops the front-door camera
the instant the bell is pressed.

The defining constraint: a **read-through proxy**. The tablet never holds the
HA token or any camera credential, and it can only touch the entities you name
in config. The API ([apps/api/src/ha/](../apps/api/src/ha/)) validates every
read and command against that whitelist; anything else is a 403.

## Two independently-optional halves

| Half | Enabled when | Gives you |
| --- | --- | --- |
| **HA controls** | `HA_BASE_URL` **and** `HA_TOKEN` are set | "Currently on" list, thermostat nudge, house fan, scenes, doorbell, weather, CO₂ |
| **Scrypted cameras** | `SCRYPTED_CAMERAS` holds ≥1 camera | Camera tiles + doorbell glance |

Either half can run without the other. With **neither** configured the tablet
shows no home panel at all and the `/ha/*` API routes do not exist — which is
how the frontend detects the disabled state (snapshot → 404 → no UI).

Code: feature gates `isHaConfigured` / `isCamerasConfigured` / `isHomeConfigured`
in [ha-config.ts](../apps/api/src/ha/ha-config.ts).

## 1. Home Assistant setup

### Create a long-lived access token

1. In Home Assistant, open your **user profile** (bottom-left avatar).
2. Scroll to **Long-lived access tokens** → **Create token**.
3. Name it (e.g. `holocron-tablet`) and copy the value — it's shown once.

Set it on the API host:

```bash
HA_BASE_URL=http://homeassistant.local:8123   # LAN URL, no trailing slash
HA_TOKEN=<the long-lived token>
```

The token stays in the API config and is never sent to the tablet
([ha-http-client.ts](../apps/api/src/ha/ha-http-client.ts) is the only thing
that attaches the `Authorization` header).

### Choose your entities

Every panel is independently optional — set the matching env var to the entity
id and the panel appears; leave it unset and the panel is hidden. Absent or
non-existent entities never render.

| Env var | Entity domain | Panel |
| --- | --- | --- |
| `HA_CLIMATE_ENTITY` | `climate.*` | Thermostat ± nudge |
| `HA_FAN_ENTITY` | `fan.*` | House fan Off/Low/High |
| `HA_WEATHER_ENTITY` | `weather.*` | Current temp + forecast |
| `HA_CO2_ENTITY` | `sensor.*` | CO₂ readout |
| `HA_SCENE_BUTTONS` | `button.*` (CSV) | Momentary `button.press` (e.g. Clean Kitchen) |
| `HA_SCENE_BOOLEANS` | `input_boolean.*` (CSV) | Stateful toggle (e.g. Night Mode) |
| `HA_DOORBELL_ENTITY` | `binary_sensor.*` | Read-only; off→on edge opens the doorbell glance |

### "Currently on" list

The on-list mirrors an `auto-entities` card: include some domains, drop a few
noisy patterns.

```bash
HA_ONLIST_INCLUDE=light,switch   # domains that count as "on-able"
HA_ONLIST_EXCLUDE=*led           # entity_id patterns to drop (status LEDs)
```

Pattern matching escapes dots literally, so `*led` / `*_led` match a trailing
`led`; `*.led` does **not**. Set `HA_ONLIST_EXCLUDE=` (empty) for no excludes.
Only domains in `HA_ONLIST_INCLUDE` are toggleable from the tablet — a toggle
for anything else is rejected with 403.

### House fan — preset-mode vs percentage

The fan panel maps three tablet states (Off / Low / High) to HA service calls.
The **default** assumes a *preset-mode* fan:

```
off  → fan.turn_off
low  → fan.set_preset_mode {preset_mode: "low"}
high → fan.set_preset_mode {preset_mode: "high"}
```

Preset names are **case-sensitive and hardware-specific**, and many fans don't
support preset modes at all — they take a `percentage`. When the configured
service doesn't fit the fan, **HA returns a non-2xx and the API logs the
reason** (the body is surfaced, not just the status), e.g.:

```
HA POST /api/services/fan/set_preset_mode failed: 400: Preset mode low is not
valid, valid preset modes are: ['Auto', 'Low', 'High']
```

Override the map (any subset is merged over the defaults) via `HA_FAN_SERVICES`
as a JSON object:

```bash
# Capitalised preset names
HA_FAN_SERVICES={"low":{"service":"fan.set_preset_mode","data":{"preset_mode":"Low"}},"high":{"service":"fan.set_preset_mode","data":{"preset_mode":"High"}}}

# Percentage fan (0=off, 50=low, 100=high)
HA_FAN_SERVICES={"off":{"service":"fan.set_percentage","data":{"percentage":0}},"low":{"service":"fan.set_percentage","data":{"percentage":50}},"high":{"service":"fan.set_percentage","data":{"percentage":100}}}
```

To find what your fan supports, read its attributes:

```bash
curl -s -H "Authorization: Bearer $HA_TOKEN" \
  "$HA_BASE_URL/api/states/fan.house" | jq '.attributes'
# look for preset_modes, percentage_step, supported_features
```

## 2. Scrypted camera setup

Cameras are served as **hotlink-ok snapshot URLs** through HA's reverse proxy.
The API never touches image bytes and holds no camera credential — it only
hands the tablet a URL template, and the tablet fetches frames directly.

Configure them as a JSON array in `SCRYPTED_CAMERAS`:

```bash
SCRYPTED_CAMERAS=[
  {"id":"front_door","name":"Front door","doorbell":true,"urlTemplate":"http://homeassistant.local:8123/api/scrypted/<token>/endpoint/@scrypted/snapshot/hotlink-ok/<id>/Camera/{ts}.jpg?width={width}"},
  {"id":"driveway","name":"Driveway","urlTemplate":"http://homeassistant.local:8123/api/scrypted/<token>/endpoint/@scrypted/snapshot/hotlink-ok/<id>/Camera/{ts}.jpg?width={width}"}
]
```

(Keep it on a single line in `.env`.)

| Field | Meaning |
| --- | --- |
| `id` | Stable key (also a CSS tint hint on the tile) |
| `name` | Tile label; first word is the short badge |
| `doorbell` | `true` on the camera that the doorbell glance opens |
| `urlTemplate` | hotlink-ok snapshot URL with `{ts}` (cache-buster) and `{width}` placeholders — **keep both tokens** |

```bash
# One canonical width requested from every hotlink URL → one server-side resize
# per fresh frame; each tile downscales in CSS. Default 768.
SCRYPTED_SNAPSHOT_WIDTH=768
```

The config parser is tolerant: a blank/malformed `SCRYPTED_CAMERAS` degrades to
"no cameras" rather than crashing boot. A camera entry missing `id` or
`urlTemplate` is skipped.

## How it fits together

- **Reads** flow over a long-lived HA WebSocket (`state_changed`), shaped into a
  compact snapshot for the tablet ([ha-event-source.ts](../apps/api/src/ha/ha-event-source.ts),
  [ha-proxy.service.ts](../apps/api/src/ha/ha-proxy.service.ts)). A cold tablet
  load falls back to a one-shot REST fetch.
- **Commands** (toggle, climate nudge, fan, scene, boolean) are POSTed to the
  API, validated against the whitelist, then forwarded to HA. The thermostat is
  a server-side read-modify-write (clamps to the entity's min/max/step).
- **The doorbell** rides the same WS as a read-only addition; its off→on edge
  stamps `doorbell.rangAt`, which the tablet turns into the glance.

See the module map in [../CLAUDE.md](../CLAUDE.md#module-map).
