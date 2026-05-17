import { CSSProperties } from 'react';

/**
 * Home-surface domain glyphs. Kept separate from the chrome `Icon` set so
 * the home surface owns its own vocabulary (thermo/fan/cloud/camera/doorbell/
 * scene). Simple stroke shapes, no icon font.
 */
export type HomeGlyphName =
  | 'bulb'
  | 'thermo'
  | 'fan'
  | 'cloud'
  | 'drizzle'
  | 'camera'
  | 'doorbell'
  | 'scene'
  | 'list';

interface HomeGlyphProps {
  name: HomeGlyphName;
  size?: number;
  color?: string;
  stroke?: number;
  style?: CSSProperties;
}

export function HomeGlyph({
  name,
  size = 20,
  color = 'currentColor',
  stroke = 2,
  style,
}: HomeGlyphProps) {
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
    case 'bulb':
      return (
        <svg {...p}>
          <path d="M9 18h6M10 21h4" />
          <path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.3 1 2.5h6c0-1.2.3-1.8 1-2.5A6 6 0 0 0 12 3Z" />
        </svg>
      );
    case 'thermo':
      return (
        <svg {...p}>
          <path d="M12 4a2 2 0 0 0-2 2v8.2a3.5 3.5 0 1 0 4 0V6a2 2 0 0 0-2-2Z" />
          <path d="M12 14V9" />
        </svg>
      );
    case 'fan':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="1.6" />
          <path d="M12 10.5C12 6 13 3 15 3s2 4-1 7M13.5 12C18 12 21 13 21 15s-4 2-7-1M12 13.5C12 18 11 21 9 21s-2-4 1-7M10.5 12C6 12 3 11 3 9s4-2 7 1" />
        </svg>
      );
    case 'cloud':
      return (
        <svg {...p}>
          <path d="M7 18a4 4 0 0 1-.5-7.97A5 5 0 0 1 16 9.5a3.5 3.5 0 0 1 .5 8.5Z" />
        </svg>
      );
    case 'drizzle':
      return (
        <svg {...p}>
          <path d="M7 15a4 4 0 0 1-.5-7.97A5 5 0 0 1 16 6.5a3.5 3.5 0 0 1 .5 7.5" />
          <path d="M8 18l-1 2M12 18l-1 2M16 18l-1 2" />
        </svg>
      );
    case 'camera':
      return (
        <svg {...p}>
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <circle cx="12" cy="12.5" r="3.2" />
          <path d="M8 6l1.5-2h5L16 6" />
        </svg>
      );
    case 'doorbell':
      return (
        <svg {...p}>
          <rect x="6" y="3" width="12" height="18" rx="3" />
          <circle cx="12" cy="9" r="2" />
          <path d="M12 13v4" />
        </svg>
      );
    case 'scene':
      return (
        <svg {...p}>
          <path d="M12 3l1.8 5 5 1.8-5 1.8L12 17l-1.8-5.4-5-1.8 5-1.8Z" />
          <path d="M18 15l.7 2 2 .7-2 .7L18 21l-.7-1.6-2-.7 2-.7Z" />
        </svg>
      );
    case 'list':
      return (
        <svg {...p}>
          <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
        </svg>
      );
    default:
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
  }
}
