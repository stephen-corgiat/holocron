import { CSSProperties, useEffect, useRef, useState } from 'react';
import { Glyph } from '../icons/Glyph';
import { HaPanel } from './HaPanel';
import { HaSnapshot } from './ha-source';

type Scenes = NonNullable<HaSnapshot['scenes']>;

/**
 * Scenes panel (Home view only): a momentary
 * Clean Kitchen action with the local "Run robot" → "Running…" transient, and
 * a Night Mode input_boolean toggle reflecting live on/off. Each action is
 * independently optional — render only what the snapshot carries.
 */
export function ScenesPanel({
  scenes,
  onPressButton,
  onSetBoolean,
  style,
}: {
  scenes: Scenes;
  onPressButton: (entityId: string) => void;
  onSetBoolean: (entityId: string, on: boolean) => void;
  style?: CSSProperties;
}) {
  return (
    <HaPanel glyph="scene" title="Scenes" style={style}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: 12,
        }}
      >
        {scenes.cleanKitchen && (
          <CleanKitchen
            avail={scenes.cleanKitchen.avail}
            entityId={scenes.cleanKitchen.entityId}
            onPress={onPressButton}
          />
        )}
        {scenes.nightMode && (
          <NightMode
            entityId={scenes.nightMode.entityId}
            avail={scenes.nightMode.avail}
            on={scenes.nightMode.on}
            onToggle={onSetBoolean}
          />
        )}
      </div>
    </HaPanel>
  );
}

function CleanKitchen({
  entityId,
  avail,
  onPress,
}: {
  entityId: string;
  avail: 'ok' | 'unavailable';
  onPress: (entityId: string) => void;
}) {
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const disabled = avail === 'unavailable' || running;
  const run = () => {
    if (disabled) return;
    onPress(entityId);
    setRunning(true);
    timer.current = setTimeout(() => setRunning(false), 1600);
  };
  return (
    <button
      type="button"
      aria-label="Clean Kitchen"
      onClick={run}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        width: '100%',
        padding: '12px 13px',
        borderRadius: 11,
        cursor: disabled ? 'default' : 'pointer',
        textAlign: 'left',
        background: running ? 'var(--tb-primary-soft)' : 'var(--tb-surface2)',
        border: `1px solid ${running ? 'var(--tb-primary)' : 'var(--tb-line)'}`,
        boxShadow: running ? 'var(--tb-glow)' : 'none',
        opacity: avail === 'unavailable' ? 0.45 : 1,
        transition: 'background .15s, border-color .15s',
      }}
    >
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--tb-surface)',
          border: '1px solid var(--tb-line)',
          color: running ? 'var(--tb-primary)' : 'var(--tb-ink2)',
        }}
      >
        <Glyph name="clean" size={20} color="currentColor" />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--tb-ink)' }}>
          Clean Kitchen
        </span>
        <span
          style={{
            display: 'block',
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: 1,
            marginTop: 2,
            fontFamily: 'var(--tb-font-mono)',
            textTransform: 'uppercase',
            color: running ? 'var(--tb-primary)' : 'var(--tb-muted)',
          }}
        >
          {running ? 'Running…' : 'Run robot'}
        </span>
      </span>
      {running ? (
        <Glyph name="spark" size={16} color="var(--tb-primary)" />
      ) : (
        <ArrowRight color="var(--tb-muted)" />
      )}
    </button>
  );
}

function NightMode({
  entityId,
  avail,
  on,
  onToggle,
}: {
  entityId: string;
  avail: 'ok' | 'unavailable';
  on: boolean;
  onToggle: (entityId: string, on: boolean) => void;
}) {
  const disabled = avail === 'unavailable';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Night Mode"
      onClick={() => !disabled && onToggle(entityId, !on)}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        width: '100%',
        padding: '12px 13px',
        borderRadius: 11,
        cursor: disabled ? 'default' : 'pointer',
        textAlign: 'left',
        background: on ? 'var(--tb-primary-soft)' : 'var(--tb-surface2)',
        border: `1px solid ${on ? 'var(--tb-primary)' : 'var(--tb-line)'}`,
        boxShadow: on ? 'var(--tb-glow)' : 'none',
        opacity: disabled ? 0.45 : 1,
        transition: 'background .15s, border-color .15s',
      }}
    >
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--tb-surface)',
          border: '1px solid var(--tb-line)',
          color: on ? 'var(--tb-primary)' : 'var(--tb-ink2)',
        }}
      >
        <Glyph name="moon" size={20} color="currentColor" />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--tb-ink)' }}>
          Night Mode
        </span>
        <span
          style={{
            display: 'block',
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: 1,
            marginTop: 2,
            fontFamily: 'var(--tb-font-mono)',
            textTransform: 'uppercase',
            color: on ? 'var(--tb-primary)' : 'var(--tb-muted)',
          }}
        >
          {on ? 'On' : 'Off'}
        </span>
      </span>
      <ToggleVisual on={on} />
    </button>
  );
}

/** Read-only switch visual (the parent button owns the click/role). */
function ToggleVisual({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 46,
        height: 26,
        borderRadius: 999,
        flexShrink: 0,
        background: on ? 'var(--tb-primary)' : 'var(--tb-surface2)',
        border: `1px solid ${on ? 'var(--tb-primary)' : 'var(--tb-line)'}`,
        boxShadow: on ? 'var(--tb-glow)' : 'none',
        position: 'relative',
        transition: 'background .15s',
        display: 'inline-block',
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
    </span>
  );
}

function ArrowRight({ color }: { color: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
