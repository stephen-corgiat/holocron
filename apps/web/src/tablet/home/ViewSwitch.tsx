import { Icon } from '../icons/Icon';
import { HomeGlyph } from './glyphs';

export type Surface = 'routine' | 'home';

/**
 * Routine ⇆ Home top-level surface switch, shown in the header only when HA
 * is configured.
 */
export function ViewSwitch({
  surface,
  onChange,
}: {
  surface: Surface;
  onChange: (next: Surface) => void;
}) {
  const items: { id: Surface; label: string }[] = [
    { id: 'routine', label: 'Routine' },
    { id: 'home', label: 'Home' },
  ];
  return (
    <div
      role="tablist"
      aria-label="Routine or Home"
      style={{
        display: 'flex',
        gap: 4,
        padding: 4,
        background: 'var(--tb-surface2)',
        borderRadius: 10,
        border: '1px solid var(--tb-line)',
      }}
    >
      {items.map((it) => {
        const on = it.id === surface;
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(it.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '7px 13px',
              borderRadius: 8,
              border: 0,
              cursor: 'pointer',
              background: on ? 'var(--tb-surface)' : 'transparent',
              boxShadow: on ? 'var(--tb-glow)' : 'none',
              color: on ? 'var(--tb-ink)' : 'var(--tb-ink2)',
              font: 'inherit',
            }}
          >
            {it.id === 'home' ? (
              <Icon
                name="home"
                size={15}
                stroke={2.2}
                color={on ? 'var(--tb-primary)' : 'currentColor'}
              />
            ) : (
              <HomeGlyph
                name="list"
                size={15}
                stroke={2.2}
                color={on ? 'var(--tb-primary)' : 'currentColor'}
              />
            )}
            <span style={{ fontSize: 13, fontWeight: 700 }}>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}
