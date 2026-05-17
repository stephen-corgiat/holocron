import { CSSProperties } from 'react';
import { HaPanel } from './HaPanel';
import { FanState, HaSnapshot } from './ha-source';

type Fan = NonNullable<HaSnapshot['fan']>;

const SEGMENTS: { label: string; value: FanState }[] = [
  { label: 'Off', value: 'off' },
  { label: 'Low', value: 'low' },
  { label: 'High', value: 'high' },
];

/**
 * House-fan panel: an Off/Low/High segmented control.
 * Picking a segment posts the state; the server maps it via its config-driven
 * state→service map. Renders only when `fan` is present; offline ⇒ the
 * dimmed UNAVAILABLE treatment.
 */
export function FanPanel({
  fan,
  entityId,
  onSetFan,
  busy,
  style,
}: {
  fan: Fan;
  entityId: string;
  onSetFan: (entityId: string, state: FanState) => void;
  busy?: boolean;
  style?: CSSProperties;
}) {
  const unavailable = fan.avail === 'unavailable';
  return (
    <HaPanel glyph="fan" title="House fan" unavailable={unavailable} style={style}>
      <div style={{ padding: 12 }}>
        <div
          role="group"
          aria-label="House fan speed"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 4,
            padding: 4,
            background: 'var(--tb-surface2)',
            borderRadius: 11,
            border: '1px solid var(--tb-line2)',
          }}
        >
          {SEGMENTS.map((seg) => {
            const on = seg.value === fan.state;
            return (
              <button
                key={seg.value}
                type="button"
                aria-pressed={on}
                disabled={busy}
                onClick={() => onSetFan(entityId, seg.value)}
                style={{
                  padding: '12px 4px',
                  border: 0,
                  borderRadius: 8,
                  cursor: busy ? 'default' : 'pointer',
                  background: on ? 'var(--tb-primary)' : 'transparent',
                  color: on ? '#0b1417' : 'var(--tb-ink2)',
                  boxShadow: on ? 'var(--tb-glow)' : 'none',
                  fontFamily: 'var(--tb-font-mono)',
                  fontSize: 13,
                  fontWeight: 800,
                  letterSpacing: 0.8,
                  textTransform: 'uppercase',
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {seg.label}
              </button>
            );
          })}
        </div>
      </div>
    </HaPanel>
  );
}
