import { CSSProperties } from 'react';

/**
 * Domain glyph set — the things admins pick for tasks and goals. Inline SVG
 * so colour/size are CSS-driven. When the stored `icon` field is not in this
 * registry the component falls back to rendering the raw string (so legacy
 * emoji rows render unchanged without a backfill migration).
 */
export type GlyphName =
  | 'tooth'
  | 'bed'
  | 'breakfast'
  | 'backpack'
  | 'book'
  | 'homework'
  | 'piano'
  | 'moon'
  | 'sun'
  | 'vacuum'
  | 'dish'
  | 'trash'
  | 'clean'
  | 'draw'
  | 'blocks'
  | 'plant'
  | 'cat'
  | 'snack'
  | 'walk'
  | 'spark'
  | 'edit'
  | 'wand'
  | 'minus'
  | 'trophy'
  | 'umbrella'
  | 'cube'
  | 'gamepad'
  | 'tv'
  | 'wifi'
  | 'fire'
  | 'coin'
  | 'check'
  | 'alert'
  | 'send'
  | 'lock'
  | 'unlock'
  | 'holocron-logo';

interface GlyphProps {
  /** Glyph name OR a raw legacy string (e.g. emoji) to render as text. */
  name?: string | null;
  size?: number;
  color?: string;
  stroke?: number;
  style?: CSSProperties;
}

const REGISTRY: Record<string, true> = {
  tooth: true,
  bed: true,
  breakfast: true,
  backpack: true,
  book: true,
  homework: true,
  piano: true,
  moon: true,
  sun: true,
  vacuum: true,
  dish: true,
  trash: true,
  clean: true,
  draw: true,
  blocks: true,
  plant: true,
  cat: true,
  snack: true,
  walk: true,
  spark: true,
  edit: true,
  wand: true,
  minus: true,
  trophy: true,
  umbrella: true,
  cube: true,
  gamepad: true,
  tv: true,
  wifi: true,
  fire: true,
  coin: true,
  check: true,
  alert: true,
  send: true,
  lock: true,
  unlock: true,
  'holocron-logo': true,
};

export function isKnownGlyph(name?: string | null): name is GlyphName {
  if (!name) return false;
  return REGISTRY[name] === true;
}

export function Glyph({
  name,
  size = 20,
  color = 'currentColor',
  stroke = 2,
  style,
}: GlyphProps) {
  if (!isKnownGlyph(name)) {
    // Legacy emoji / unknown string: render as text so existing rows keep
    // their visual identity without a migration.
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          fontSize: size * 0.85,
          lineHeight: 1,
          ...style,
        }}
      >
        {name ?? ''}
      </span>
    );
  }
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: stroke,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    style,
  };
  switch (name) {
    case 'tooth':
      return (
        <svg {...p}>
          <path d="M7 3c-2 0-4 2-4 5 0 2 1 3 1 5 0 3 1 8 3 8 2 0 2-4 3-6 .5-1 1.5-1 2 0 1 2 1 6 3 6 2 0 3-5 3-8 0-2 1-3 1-5 0-3-2-5-4-5-2 0-3 1-5 1S9 3 7 3Z" />
        </svg>
      );
    case 'bed':
      return (
        <svg {...p}>
          <path d="M3 18V8M3 14h18M21 18v-4a3 3 0 0 0-3-3H10v3" />
          <circle cx="7" cy="12" r="1.5" />
        </svg>
      );
    case 'breakfast':
      return (
        <svg {...p}>
          <circle cx="12" cy="11" r="6" />
          <path d="M9 11c0-2 1.5-3 3-3M6 17h12" />
        </svg>
      );
    case 'backpack':
      return (
        <svg {...p}>
          <path d="M6 8a4 4 0 0 1 8 0M5 8h14v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8Z" />
          <path d="M9 13h6v3H9z" />
        </svg>
      );
    case 'book':
      return (
        <svg {...p}>
          <path d="M4 4v15a2 2 0 0 0 2 2h14V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2Z" />
          <path d="M8 4v15M4 19h14" />
        </svg>
      );
    case 'homework':
      return (
        <svg {...p}>
          <path d="M5 4h12l3 3v13H5z" />
          <path d="M9 11h8M9 15h6" />
        </svg>
      );
    case 'piano':
      return (
        <svg {...p}>
          <rect x="3" y="5" width="18" height="14" rx="1" />
          <path d="M8 5v9M12 5v9M16 5v9M3 14h18" />
        </svg>
      );
    case 'moon':
      return (
        <svg {...p}>
          <path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z" />
        </svg>
      );
    case 'sun':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
        </svg>
      );
    case 'vacuum':
      return (
        <svg {...p}>
          <circle cx="17" cy="17" r="4" />
          <path d="M17 13V5l-5 2-4-2v6" />
        </svg>
      );
    case 'dish':
      return (
        <svg {...p}>
          <path d="M3 11h18a9 9 0 0 1-18 0Z" />
          <path d="M3 11h18" />
          <path d="M9 4l3 4 3-4" />
        </svg>
      );
    case 'trash':
      return (
        <svg {...p}>
          <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
        </svg>
      );
    case 'clean':
      return (
        <svg {...p}>
          <path d="M14 4l6 6-9 9H5v-6Z" />
          <path d="M12 6l6 6" />
        </svg>
      );
    case 'draw':
      return (
        <svg {...p}>
          <path d="M3 21l3-1 11-11-2-2L4 18Z" />
          <path d="M14 7l3 3" />
        </svg>
      );
    case 'blocks':
      return (
        <svg {...p}>
          <rect x="4" y="4" width="7" height="7" rx="1" />
          <rect x="13" y="4" width="7" height="7" rx="1" />
          <rect x="4" y="13" width="7" height="7" rx="1" />
          <rect x="13" y="13" width="7" height="7" rx="1" />
        </svg>
      );
    case 'plant':
      return (
        <svg {...p}>
          <path d="M12 21V10" />
          <path d="M12 10c0-3-2-5-5-5 0 3 2 5 5 5Z" />
          <path d="M12 12c0-3 2-5 5-5 0 3-2 5-5 5Z" />
          <path d="M7 21h10" />
        </svg>
      );
    case 'cat':
      return (
        <svg {...p}>
          <path d="M4 7l2 5a6 6 0 0 0 12 0l2-5-4 3a8 8 0 0 0-8 0Z" />
          <circle cx="10" cy="12" r=".5" fill={color} />
          <circle cx="14" cy="12" r=".5" fill={color} />
        </svg>
      );
    case 'snack':
      return (
        <svg {...p}>
          <path d="M5 11h14l-1 8H6Z" />
          <path d="M5 11a7 7 0 0 1 14 0" />
        </svg>
      );
    case 'walk':
      return (
        <svg {...p}>
          <circle cx="13" cy="4" r="1.5" />
          <path d="M11 8l-2 5 3 2v6" />
          <path d="M12 15l3 3M9 13l-3 3" />
        </svg>
      );
    case 'spark':
      return (
        <svg {...p}>
          <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" />
        </svg>
      );
    case 'edit':
      return (
        <svg {...p}>
          <path d="M4 20h4l10-10-4-4L4 16Z" />
          <path d="M14 6l4 4" />
        </svg>
      );
    case 'wand':
      return (
        <svg {...p}>
          <path d="M3 21l12-12M11 5l1 2 2 1-2 1-1 2-1-2-2-1 2-1ZM18 3l.5 1 1 .5-1 .5L18 6l-.5-1-1-.5 1-.5Z" />
        </svg>
      );
    case 'minus':
      return (
        <svg {...p}>
          <path d="M5 12h14" />
        </svg>
      );
    case 'trophy':
      return (
        <svg {...p}>
          <path d="M8 4h8v6a4 4 0 0 1-8 0Z" />
          <path d="M16 6h3v2a3 3 0 0 1-3 3M8 6H5v2a3 3 0 0 0 3 3" />
          <path d="M10 14v3h4v-3M8 20h8" />
        </svg>
      );
    case 'umbrella':
      return (
        <svg {...p}>
          <path d="M3 12a9 9 0 0 1 18 0Z" />
          <path d="M12 12v7a2 2 0 0 1-4 0" />
        </svg>
      );
    case 'cube':
      return (
        <svg {...p}>
          <path d="M12 3l9 5v8l-9 5-9-5V8Z" />
          <path d="M3 8l9 5 9-5M12 13v9" />
        </svg>
      );
    case 'gamepad':
      return (
        <svg {...p}>
          <path d="M6 8h12a4 4 0 0 1 0 8c-2 0-2.5-2-4-2h-4c-1.5 0-2 2-4 2a4 4 0 0 1 0-8Z" />
          <path d="M9 12h2M10 11v2M15 11h0M17 13h0" />
        </svg>
      );
    case 'tv':
      return (
        <svg {...p}>
          <rect x="3" y="5" width="18" height="12" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      );
    case 'wifi':
      return (
        <svg {...p}>
          <path d="M2 9a16 16 0 0 1 20 0" />
          <path d="M5 13a11 11 0 0 1 14 0" />
          <path d="M8.5 16.5a6 6 0 0 1 7 0" />
          <circle cx="12" cy="20" r=".8" fill={color} />
        </svg>
      );
    case 'fire':
      return (
        <svg {...p}>
          <path d="M12 3s4 4 4 8a4 4 0 0 1-8 0c0-1 .5-2 1-2.5 0 2 2 2 2 0 0-3-1-4 1-5.5Z" />
        </svg>
      );
    case 'coin':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9 9h4a2 2 0 0 1 0 4H9m0 0h5" />
        </svg>
      );
    case 'check':
      return (
        <svg {...p}>
          <polyline points="4 12 10 18 20 6" />
        </svg>
      );
    case 'alert':
      return (
        <svg {...p}>
          <path d="M12 3l10 17H2Z" />
          <path d="M12 10v5M12 18v.5" />
        </svg>
      );
    case 'send':
      return (
        <svg {...p}>
          <path d="M3 12l18-8-7 18-3-7-8-3Z" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...p}>
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      );
    case 'unlock':
      return (
        <svg {...p}>
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 7-2" />
        </svg>
      );
    case 'holocron-logo':
      return <HolocronLogo size={size} color={color} />;
  }
}

/**
 * Geometric wireframe cube + glowing hex core — used as the splash glyph on
 * the celebration overlay and as a watermark on the balance hero.
 */
export function HolocronLogo({
  size = 36,
  color = '#00E5FF',
  core = '#00E5FF',
  glow = true,
}: {
  size?: number;
  color?: string;
  core?: string;
  glow?: boolean;
}) {
  const id = `hc-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <filter id={id} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g
        fill="none"
        stroke={color}
        strokeWidth="0.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={glow ? { filter: `url(#${id})` } : undefined}
        opacity="0.95"
      >
        <path d="M14 12 L34 12 L40 18 L40 38 L20 38 L14 32 Z" />
        <path d="M8 18 L28 18 L28 38 L8 38 Z" />
        <path d="M8 18 L14 12 M28 18 L34 12 M28 38 L40 38 M28 18 L40 18 M14 12 L14 32 M14 32 L20 38" />
      </g>
      <g transform="translate(18 23)">
        <polygon
          points="5,0 9,2.7 9,7.3 5,10 1,7.3 1,2.7"
          fill={core}
          style={{ filter: glow ? `drop-shadow(0 0 4px ${core})` : 'none' }}
        />
      </g>
    </svg>
  );
}
