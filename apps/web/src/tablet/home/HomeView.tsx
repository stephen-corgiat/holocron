import { FanState, HaSnapshot } from './ha-source';
import { LightsPanel } from './LightsPanel';
import { CameraTile } from './CameraTile';
import { HomeGlyph } from './glyphs';
import { ThermostatPanel } from './ThermostatPanel';
import { FanPanel } from './FanPanel';
import { WeatherPanel } from './WeatherPanel';
import { ScenesPanel } from './ScenesPanel';

/**
 * The dedicated "Home" view body, rendered in
 * place of the routine board when the Routine/Home switch is on Home. The left
 * column is the HA controls cluster — Currently-On `LightsPanel` grows, then a
 * Thermostat + Fan row, then a Weather + Scenes row. The right pane is the 2×2
 * camera grid, fed from the static `snapshot.cameras` config. Per-panel
 * rendering: only configured blocks appear, so the layout collapses to a
 * single column when no cameras exist, the controls column reflows as panels
 * come and go, and on a cameras-only install (no HA controls) the cameras fill
 * the surface with no controls column.
 */
export function HomeView({
  snapshot,
  onToggle,
  onNudgeClimate,
  onSetFan,
  onPressButton,
  onSetBoolean,
  busy,
  surfaceActive = true,
}: {
  snapshot: HaSnapshot;
  onToggle: (entityId: string, on: boolean) => void;
  onNudgeClimate: (entityId: string, dir: 1 | -1) => void;
  onSetFan: (entityId: string, state: FanState) => void;
  onPressButton: (entityId: string) => void;
  onSetBoolean: (entityId: string, on: boolean) => void;
  busy?: Set<string>;
  /** Whether the Home view is the on-screen surface (pauses hidden refreshes). */
  surfaceActive?: boolean;
}) {
  const cameras = snapshot.cameras ?? [];
  const hasCameras = cameras.length > 0;
  // A cameras-only install (no HA control creds) shows cameras full-bleed with
  // no controls column.
  const camerasOnly = hasCameras && !snapshot.haEnabled;
  const width = snapshot.snapshotWidth ?? 768;
  const { climate, fan, weather, scenes } = snapshot;

  return (
    <div
      className="ha-home-view"
      style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: hasCameras && !camerasOnly ? '424px 1fr' : '1fr',
        gap: 18,
        padding: 18,
        minHeight: 0,
      }}
    >
      {/* LEFT — HA controls cluster (omitted on a cameras-only install) */}
      {!camerasOnly && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            minHeight: 0,
            maxWidth: hasCameras ? undefined : 560,
          }}
        >
          <LightsPanel
            lights={snapshot.lights}
            onToggle={onToggle}
            busy={busy}
            style={{ flex: 1, minHeight: 0 }}
          />
          {(climate || fan) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {climate && (
                <ThermostatPanel
                  climate={climate}
                  entityId={climate.entityId}
                  onNudge={onNudgeClimate}
                  busy={busy?.has(climate.entityId)}
                />
              )}
              {fan && (
                <FanPanel
                  fan={fan}
                  entityId={fan.entityId}
                  onSetFan={onSetFan}
                  busy={busy?.has(fan.entityId)}
                />
              )}
            </div>
          )}
          {(weather || scenes) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {weather && <WeatherPanel weather={weather} />}
              {scenes && (
                <ScenesPanel
                  scenes={scenes}
                  onPressButton={onPressButton}
                  onSetBoolean={onSetBoolean}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* RIGHT — 2×2 camera grid */}
      {hasCameras && (
        <div
          className="ha-camera-grid"
          style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <HomeGlyph name="camera" size={17} color="var(--tb-ink2)" stroke={1.9} />
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                color: 'var(--tb-ink2)',
                textTransform: 'uppercase',
                letterSpacing: 1,
                fontFamily: 'var(--tb-font-mono)',
              }}
            >
              Cameras
            </div>
            <div style={{ flex: 1, height: 1, background: 'var(--tb-line2)' }} />
            <span
              style={{
                fontSize: 10,
                color: 'var(--tb-muted)',
                fontFamily: 'var(--tb-font-mono)',
                letterSpacing: 0.4,
              }}
            >
              {cameras.length} {cameras.length === 1 ? 'FEED' : 'FEEDS'} · 5s REFRESH
            </span>
          </div>
          <div
            style={{
              flex: 1,
              display: 'grid',
              gridTemplateColumns: cameras.length > 1 ? '1fr 1fr' : '1fr',
              gridAutoRows: '1fr',
              gap: 12,
              minHeight: 0,
            }}
          >
            {cameras.map((cam) => (
              <CameraTile
                key={cam.id}
                camera={cam}
                width={width}
                visible={surfaceActive}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
