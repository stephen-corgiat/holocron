import { CSSProperties, ReactNode } from 'react';
import { Card, Pill, SectionLabel } from '../components/primitives';
import { Icon } from '../icons/Icon';
import { HomeGlyph, HomeGlyphName } from './glyphs';

/**
 * Shared panel shell for the home surface — card + header (glyph · title ·
 * trailing) with the dimmed **UNAVAILABLE** treatment for configured-but-
 * offline entities. Reused by every panel (Lights, Thermostat, Fan, Weather,
 * Scenes).
 */
export function HaPanel({
  glyph,
  title,
  trailing,
  unavailable = false,
  children,
  style,
  className,
}: {
  glyph: HomeGlyphName;
  title: string;
  trailing?: ReactNode;
  unavailable?: boolean;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <Card
      className={className}
      style={{
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '11px 14px',
          borderBottom: '1px solid var(--tb-line2)',
        }}
      >
        <span
          style={{
            color: unavailable ? 'var(--tb-muted)' : 'var(--tb-ink2)',
            display: 'inline-flex',
          }}
        >
          <HomeGlyph name={glyph} size={17} stroke={1.9} />
        </span>
        <SectionLabel>{title}</SectionLabel>
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {unavailable ? (
            <Pill tone="danger">
              <Icon name="nosignal" size={11} stroke={2.2} /> UNAVAILABLE
            </Pill>
          ) : (
            trailing
          )}
        </div>
      </div>
      <div
        style={{
          flex: 1,
          position: 'relative',
          opacity: unavailable ? 0.45 : 1,
          filter: unavailable ? 'grayscale(.7)' : 'none',
          pointerEvents: unavailable ? 'none' : 'auto',
        }}
      >
        {children}
      </div>
    </Card>
  );
}
