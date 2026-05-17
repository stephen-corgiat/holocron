import { CSSProperties } from 'react';
import { Pill } from '../components/primitives';
import { Icon, IconName } from '../icons/Icon';
import { HaPanel } from './HaPanel';
import { HaSnapshot } from './ha-source';

type Climate = NonNullable<HaSnapshot['climate']>;

/** HVAC action → pill label/tone/icon. Idle/absent ⇒ no pill. */
function actionPill(action: Climate['action']): {
  label: string;
  tone: 'warn' | 'info';
  icon: IconName;
} | null {
  if (action === 'heating') return { label: 'HEATING', tone: 'warn', icon: 'fire' };
  if (action === 'cooling') return { label: 'COOLING', tone: 'info', icon: 'dot' };
  return null;
}

/**
 * Thermostat panel: big TARGET temp, "now"
 * current, −/+ nudge, HVAC-action pill. The tablet only sends a direction; the
 * server does the read-modify-write + clamp. Renders only when `climate` is
 * present; `avail: 'unavailable'` ⇒ the dimmed UNAVAILABLE treatment.
 */
export function ThermostatPanel({
  climate,
  entityId,
  onNudge,
  busy,
  style,
}: {
  climate: Climate;
  entityId: string;
  onNudge: (entityId: string, dir: 1 | -1) => void;
  busy?: boolean;
  style?: CSSProperties;
}) {
  const unavailable = climate.avail === 'unavailable';
  const pill = actionPill(climate.action);
  const unit = climate.unit.replace('°', '');
  return (
    <HaPanel
      glyph="thermo"
      title="Thermostat"
      unavailable={unavailable}
      style={style}
      trailing={
        pill ? (
          <Pill tone={pill.tone}>
            <Icon name={pill.icon} size={11} stroke={2.2} /> {pill.label}
          </Pill>
        ) : undefined
      }
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '14px 14px 16px',
        }}
      >
        <NudgeBtn
          icon="minus"
          label="Lower target temperature"
          disabled={busy}
          onClick={() => onNudge(entityId, -1)}
        />
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'center',
              gap: 2,
            }}
          >
            <span
              data-testid="thermostat-target"
              style={{
                fontFamily: 'var(--tb-font-mono)',
                fontSize: 40,
                fontWeight: 800,
                color: 'var(--tb-ink)',
                lineHeight: 0.9,
                letterSpacing: -1,
              }}
            >
              {Math.round(climate.target)}
            </span>
            <span
              style={{
                fontFamily: 'var(--tb-font-mono)',
                fontSize: 16,
                fontWeight: 700,
                color: 'var(--tb-muted)',
                marginTop: 2,
              }}
            >
              °{unit}
            </span>
          </div>
          <div
            style={{
              fontSize: 9,
              color: 'var(--tb-muted)',
              fontFamily: 'var(--tb-font-mono)',
              fontWeight: 800,
              letterSpacing: 1,
              marginTop: 4,
            }}
          >
            TARGET
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--tb-ink2)',
              fontFamily: 'var(--tb-font-mono)',
              marginTop: 8,
              letterSpacing: 0.4,
            }}
          >
            now{' '}
            <span style={{ color: 'var(--tb-ink)', fontWeight: 700 }}>
              {Math.round(climate.current)}°
            </span>
          </div>
        </div>
        <NudgeBtn
          icon="plus"
          label="Raise target temperature"
          disabled={busy}
          onClick={() => onNudge(entityId, 1)}
        />
      </div>
    </HaPanel>
  );
}

function NudgeBtn({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 52,
        height: 52,
        borderRadius: 13,
        flexShrink: 0,
        border: '1px solid var(--tb-line)',
        background: 'var(--tb-surface2)',
        color: 'var(--tb-ink)',
        display: 'grid',
        placeItems: 'center',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon name={icon} size={22} stroke={2.4} />
    </button>
  );
}
