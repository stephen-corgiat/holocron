import { Glyph } from '../icons/Glyph';
import { Icon } from '../icons/Icon';
import { HomeGlyph } from './glyphs';
import { FanState, HaSnapshot } from './ha-source';
import { CameraFilmstrip } from './CameraFilmstrip';

/**
 * The condensed home strip docked under the Today/routine page (the static
 * bottom bar). Renders, in order: the House
 * label, the weather mini, the compact **CO₂ readout (between weather and
 * thermostat)** with its threshold tint, the thermostat ± mini, the fan
 * segmented mini, the live "N on" lights count (when HA controls are
 * configured), the camera filmstrip (when cameras are configured), and the
 * "Open Home" affordance. Each cluster appears only when its snapshot block is
 * present. Hidden entirely when nothing is configured (the both-off
 * cascade, D6/D12 — the caller enforces it by not rendering the dock at all).
 */
export function HomeDock({
  snapshot,
  lightsOn,
  onNudgeClimate,
  onSetFan,
  filmstripActive = true,
  onOpenHome,
}: {
  snapshot: HaSnapshot;
  lightsOn: number;
  onNudgeClimate: (entityId: string, dir: 1 | -1) => void;
  onSetFan: (entityId: string, state: FanState) => void;
  /** Whether the dock is on-screen (pauses hidden filmstrip refreshes). */
  filmstripActive?: boolean;
  onOpenHome: () => void;
}) {
  const { weather, co2, climate, fan } = snapshot;
  const haEnabled = snapshot.haEnabled;
  const cameras = snapshot.cameras ?? [];
  const hasCameras = cameras.length > 0;
  const snapshotWidth = snapshot.snapshotWidth ?? 768;
  return (
    <div
      className="ha-home-dock"
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '10px 18px',
        background: 'var(--tb-surface)',
        borderTop: '1px solid var(--tb-line)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          color: 'var(--tb-ink2)',
        }}
      >
        <Icon name="home" size={15} stroke={2.2} color="var(--tb-primary)" />
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            fontFamily: 'var(--tb-font-mono)',
            letterSpacing: 1,
            textTransform: 'uppercase',
          }}
        >
          House
        </span>
      </div>

      {weather && weather.avail === 'ok' && weather.tempNow !== undefined && (
        <>
          <Divider />
          <WeatherMini
            tempNow={weather.tempNow}
            tempLow={weather.tempLow}
            tempHigh={weather.tempHigh}
          />
        </>
      )}

      {co2 && co2.avail === 'ok' && co2.ppm !== undefined && (
        <>
          <Divider />
          <Co2Readout ppm={co2.ppm} />
        </>
      )}

      {climate && climate.avail === 'ok' && (
        <>
          <Divider />
          <ThermostatMini
            target={climate.target}
            current={climate.current}
            action={climate.action}
            onNudge={(dir) => onNudgeClimate(climate.entityId, dir)}
          />
        </>
      )}

      {fan && fan.avail === 'ok' && (
        <>
          <Divider />
          <FanMini state={fan.state} onSetFan={(s) => onSetFan(fan.entityId, s)} />
        </>
      )}

      {/* lights count — only when HA controls are configured */}
      {haEnabled && (
        <>
          <Divider />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <HomeGlyph name="bulb" size={18} color="var(--tb-primary)" stroke={1.9} />
            <div>
              <div
                style={{
                  fontFamily: 'var(--tb-font-mono)',
                  fontSize: 14,
                  fontWeight: 800,
                  color: 'var(--tb-ink)',
                  lineHeight: 1,
                }}
              >
                {lightsOn} on
              </div>
              <div
                style={{
                  fontSize: 9,
                  color: 'var(--tb-muted)',
                  fontFamily: 'var(--tb-font-mono)',
                  letterSpacing: 0.3,
                }}
              >
                lights / switches
              </div>
            </div>
          </div>
        </>
      )}

      {/* cameras filmstrip → opens Home */}
      <div
        style={{
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {hasCameras && (
          <CameraFilmstrip
            cameras={cameras}
            width={snapshotWidth}
            visible={filmstripActive}
            onOpen={onOpenHome}
          />
        )}
        <button
          type="button"
          onClick={onOpenHome}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            padding: '10px 14px',
            border: '1px solid var(--tb-primary-soft)',
            borderRadius: 9,
            background: 'var(--tb-surface2)',
            color: 'var(--tb-primary)',
            fontFamily: 'var(--tb-font-mono)',
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}
        >
          <HomeGlyph name="camera" size={15} stroke={2} /> Open Home
        </button>
      </div>
    </div>
  );
}

function Divider() {
  return (
    <div
      style={{
        width: 1,
        alignSelf: 'stretch',
        background: 'var(--tb-line2)',
        margin: '6px 0',
      }}
    />
  );
}

function WeatherMini({
  tempNow,
  tempLow,
  tempHigh,
}: {
  tempNow: number;
  tempLow?: number;
  tempHigh?: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <Glyph name="sun" size={24} color="var(--tb-warn)" />
      <div>
        <div
          style={{
            fontFamily: 'var(--tb-font-mono)',
            fontSize: 16,
            fontWeight: 800,
            color: 'var(--tb-ink)',
            lineHeight: 1,
          }}
        >
          {Math.round(tempNow)}°
        </div>
        {(tempLow !== undefined || tempHigh !== undefined) && (
          <div
            style={{
              fontSize: 9,
              color: 'var(--tb-muted)',
              fontFamily: 'var(--tb-font-mono)',
              letterSpacing: 0.3,
            }}
          >
            {tempLow !== undefined ? Math.round(tempLow) : '—'} /{' '}
            {tempHigh !== undefined ? Math.round(tempHigh) : '—'}
          </div>
        )}
      </div>
    </div>
  );
}

/** Conventional CO₂ tint: good < 800 (ink) · elevated 800–1199 (amber) · ≥ 1200 (red). */
export function co2Tint(ppm: number): string {
  if (ppm >= 1200) return 'var(--tb-danger)';
  if (ppm >= 800) return 'var(--tb-warn)';
  return 'var(--tb-ink)';
}

function Co2Readout({ ppm }: { ppm: number }) {
  return (
    <div
      className="ha-dock-co2"
      style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 800,
          fontFamily: 'var(--tb-font-mono)',
          letterSpacing: 0.5,
          color: 'var(--tb-muted)',
        }}
      >
        CO₂
      </span>
      <span
        style={{
          fontFamily: 'var(--tb-font-mono)',
          fontSize: 16,
          fontWeight: 800,
          color: co2Tint(ppm),
          lineHeight: 1,
        }}
      >
        {Math.round(ppm)}
      </span>
      <span
        style={{
          fontSize: 9,
          color: 'var(--tb-muted)',
          fontFamily: 'var(--tb-font-mono)',
          letterSpacing: 0.3,
        }}
      >
        ppm
      </span>
    </div>
  );
}

function ThermostatMini({
  target,
  current,
  action,
  onNudge,
}: {
  target: number;
  current: number;
  action?: 'heating' | 'cooling' | 'idle';
  onNudge: (dir: 1 | -1) => void;
}) {
  const actionLabel =
    action === 'heating' ? 'HEAT' : action === 'cooling' ? 'COOL' : null;
  const actionColor =
    action === 'heating'
      ? 'var(--tb-warn)'
      : action === 'cooling'
        ? 'var(--tb-info)'
        : 'var(--tb-muted)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <MiniNudge icon="minus" label="Lower target temperature" onClick={() => onNudge(-1)} />
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--tb-font-mono)',
            fontSize: 16,
            fontWeight: 800,
            color: 'var(--tb-ink)',
            lineHeight: 1,
          }}
        >
          {Math.round(target)}°
        </div>
        <div
          style={{
            fontSize: 9,
            color: actionColor,
            fontFamily: 'var(--tb-font-mono)',
            fontWeight: 800,
            letterSpacing: 0.4,
          }}
        >
          {actionLabel ? `${actionLabel} · ` : ''}
          {Math.round(current)}
        </div>
      </div>
      <MiniNudge icon="plus" label="Raise target temperature" onClick={() => onNudge(1)} />
    </div>
  );
}

function MiniNudge({
  icon,
  label,
  onClick,
}: {
  icon: 'minus' | 'plus';
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        width: 30,
        height: 30,
        borderRadius: 8,
        border: '1px solid var(--tb-line)',
        background: 'var(--tb-surface2)',
        color: 'var(--tb-ink)',
        display: 'grid',
        placeItems: 'center',
        cursor: 'pointer',
      }}
    >
      <Icon name={icon} size={15} stroke={2.6} />
    </button>
  );
}

const FAN_SEGMENTS: { label: string; value: FanState }[] = [
  { label: 'Off', value: 'off' },
  { label: 'Low', value: 'low' },
  { label: 'High', value: 'high' },
];

function FanMini({
  state,
  onSetFan,
}: {
  state: FanState;
  onSetFan: (state: FanState) => void;
}) {
  return (
    <div
      role="group"
      aria-label="House fan speed"
      style={{
        display: 'flex',
        gap: 3,
        padding: 3,
        background: 'var(--tb-surface2)',
        borderRadius: 9,
        border: '1px solid var(--tb-line2)',
      }}
    >
      {FAN_SEGMENTS.map((seg) => {
        const on = seg.value === state;
        return (
          <button
            key={seg.value}
            type="button"
            aria-pressed={on}
            onClick={() => onSetFan(seg.value)}
            style={{
              padding: '6px 9px',
              border: 0,
              borderRadius: 6,
              cursor: 'pointer',
              background: on ? 'var(--tb-primary)' : 'transparent',
              color: on ? '#0b1417' : 'var(--tb-muted)',
              fontFamily: 'var(--tb-font-mono)',
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: 0.4,
            }}
          >
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}
