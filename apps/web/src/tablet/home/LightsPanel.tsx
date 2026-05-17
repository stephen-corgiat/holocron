import { CSSProperties } from 'react';
import { Pill } from '../components/primitives';
import { Glyph } from '../icons/Glyph';
import { HaPanel } from './HaPanel';
import { LightView } from './ha-source';

/**
 * "Currently on" — the baseline panel. Lists every light/switch in
 * the on-set with a per-row toggle and an "N ON" count, plus the calm
 * "Nothing on" empty state.
 */
export function LightsPanel({
  lights,
  onToggle,
  busy,
  style,
}: {
  lights: LightView[];
  onToggle: (entityId: string, on: boolean) => void;
  /** Entity ids with an in-flight toggle (disables the row's switch). */
  busy?: Set<string>;
  style?: CSSProperties;
}) {
  const empty = lights.length === 0;
  return (
    <HaPanel
      glyph="bulb"
      title="Currently on"
      style={style}
      trailing={!empty ? <Pill tone="primary">{lights.length} ON</Pill> : undefined}
    >
      {empty ? (
        <div
          style={{
            display: 'grid',
            placeItems: 'center',
            height: '100%',
            padding: '26px 16px',
            textAlign: 'center',
          }}
        >
          <div>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                margin: '0 auto',
                background: 'var(--tb-surface2)',
                border: '1px solid var(--tb-line)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--tb-muted)',
              }}
            >
              <Glyph name="moon" size={24} color="currentColor" />
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: 'var(--tb-ink2)',
                marginTop: 12,
              }}
            >
              Nothing on
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--tb-muted)',
                marginTop: 4,
                fontFamily: 'var(--tb-font-mono)',
                letterSpacing: 0.3,
              }}
            >
              Every light &amp; switch is off
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: 8,
            gap: 4,
          }}
        >
          {lights.map((l, i) => (
            <div
              key={l.entityId}
              className="ha-light-row"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                alignItems: 'center',
                gap: 12,
                padding: '8px 10px',
                borderRadius: 9,
                background: i % 2 ? 'transparent' : 'var(--tb-surface2)',
              }}
            >
              <div
                style={{
                  minWidth: 0,
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--tb-ink)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {l.name}
                </span>
                <span
                  style={{
                    fontSize: 9,
                    color: 'var(--tb-muted)',
                    fontFamily: 'var(--tb-font-mono)',
                    letterSpacing: 0.5,
                    textTransform: 'uppercase',
                  }}
                >
                  {l.kind}
                </span>
              </div>
              <ToggleSwitch
                on={l.on}
                disabled={busy?.has(l.entityId)}
                label={`Toggle ${l.name}`}
                onClick={() => onToggle(l.entityId, !l.on)}
              />
            </div>
          ))}
        </div>
      )}
    </HaPanel>
  );
}

function ToggleSwitch({
  on,
  disabled,
  label,
  onClick,
}: {
  on: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 46,
        height: 26,
        borderRadius: 999,
        flexShrink: 0,
        padding: 0,
        background: on ? 'var(--tb-primary)' : 'var(--tb-surface2)',
        border: `1px solid ${on ? 'var(--tb-primary)' : 'var(--tb-line)'}`,
        boxShadow: on ? 'var(--tb-glow)' : 'none',
        position: 'relative',
        transition: 'background .15s',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 22 : 2,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: on ? '#0b1417' : 'var(--tb-muted)',
          transition: 'left .15s',
        }}
      />
    </button>
  );
}
