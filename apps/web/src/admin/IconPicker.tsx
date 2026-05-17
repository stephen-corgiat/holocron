import { useEffect, useRef, useState } from 'react';
import { Glyph, isKnownGlyph } from '../tablet/icons/Glyph';
import {
  GLYPH_GROUP_LABELS,
  LISTED_GLYPHS,
  GlyphEntry,
} from '../tablet/icons/registry';
import '../tablet/tablet.css';

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}

/**
 * Admin-side picker that surfaces every registered glyph + lets the user
 * clear or keep a custom string (legacy emoji values still render via the
 * `Glyph` fallback). Stores the glyph **id** (string) so historical free-text
 * rows stay readable.
 */
export function IconPicker({ value, onChange, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const grouped = LISTED_GLYPHS.reduce<Record<GlyphEntry['group'], GlyphEntry[]>>(
    (acc, g) => {
      acc[g.group] = acc[g.group] ?? [];
      acc[g.group].push(g);
      return acc;
    },
    {} as Record<GlyphEntry['group'], GlyphEntry[]>,
  );

  const known = isKnownGlyph(value);
  const label = known
    ? LISTED_GLYPHS.find((g) => g.id === value)?.label ?? value
    : value
      ? `Custom: ${value}`
      : placeholder ?? 'Pick an icon';

  return (
    <div className="admin-icon-picker" ref={wrapRef}>
      <button
        type="button"
        className="admin-icon-picker-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="preview">
          {value ? (
            <Glyph name={value} size={18} color="currentColor" />
          ) : (
            <span style={{ opacity: 0.5 }}>?</span>
          )}
        </span>
        <span className="label">{label}</span>
        <span style={{ opacity: 0.6, fontFamily: 'var(--tb-font-mono)', fontSize: 10 }}>
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && (
        <div className="admin-icon-picker-panel" role="listbox">
          {(Object.keys(grouped) as GlyphEntry['group'][]).map((group) => (
            <div key={group}>
              <div className="admin-icon-picker-group">
                {GLYPH_GROUP_LABELS[group]}
              </div>
              <div className="admin-icon-picker-grid">
                {grouped[group].map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className={`admin-icon-picker-cell ${value === g.id ? 'is-on' : ''}`}
                    onClick={() => {
                      onChange(g.id);
                      setOpen(false);
                    }}
                    title={g.label}
                  >
                    <Glyph name={g.id} size={22} color="currentColor" />
                    <span className="lbl">{g.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button
            type="button"
            className="admin-icon-picker-clear"
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
          >
            Clear icon
          </button>
        </div>
      )}
    </div>
  );
}
