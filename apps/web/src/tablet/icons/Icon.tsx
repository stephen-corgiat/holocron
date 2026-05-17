import { CSSProperties } from 'react';

/**
 * Stroke-icon set used in the tablet UI chrome (status bar, tab bar, pills,
 * buttons). Inline SVG so we don't ship a font or icon library. Names are
 * stable identifiers — the registry in `./registry.ts` enumerates them for
 * the admin picker and tests.
 */
export type IconName =
  | 'check'
  | 'circle'
  | 'clock'
  | 'alert'
  | 'lock'
  | 'unlock'
  | 'chevron-r'
  | 'chevron-l'
  | 'chevron-d'
  | 'coin'
  | 'fire'
  | 'user'
  | 'filter'
  | 'away'
  | 'home'
  | 'wifi'
  | 'signal'
  | 'nosignal'
  | 'send'
  | 'x'
  | 'plus'
  | 'minus'
  | 'edit'
  | 'dot'
  | 'info'
  | 'search';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  stroke?: number;
  style?: CSSProperties;
  title?: string;
}

export function Icon({
  name,
  size = 20,
  color = 'currentColor',
  stroke = 2,
  style,
  title,
}: IconProps) {
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
    role: title ? 'img' : undefined,
    'aria-label': title,
  };
  switch (name) {
    case 'check':
      return (
        <svg {...p}>
          <polyline points="4 12 10 18 20 6" />
        </svg>
      );
    case 'circle':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'alert':
      return (
        <svg {...p}>
          <path d="M12 3l10 17H2Z" />
          <path d="M12 10v5M12 18v.5" />
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
    case 'chevron-r':
      return (
        <svg {...p}>
          <path d="M9 6l6 6-6 6" />
        </svg>
      );
    case 'chevron-l':
      return (
        <svg {...p}>
          <path d="M15 6l-6 6 6 6" />
        </svg>
      );
    case 'chevron-d':
      return (
        <svg {...p}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      );
    case 'coin':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9 9h4a2 2 0 0 1 0 4H9m0 0h5" />
        </svg>
      );
    case 'fire':
      return (
        <svg {...p}>
          <path d="M12 3s4 4 4 8a4 4 0 0 1-8 0c0-1 .5-2 1-2.5 0 2 2 2 2 0 0-3-1-4 1-5.5Z" />
        </svg>
      );
    case 'user':
      return (
        <svg {...p}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      );
    case 'filter':
      return (
        <svg {...p}>
          <path d="M3 5h18l-7 9v6l-4-2v-4Z" />
        </svg>
      );
    case 'away':
      return (
        <svg {...p}>
          <path d="M5 21V9l7-5 7 5v12" />
          <path d="M10 21v-6h4v6" />
          <path d="M16 3l4 4-4 4M20 7H10" />
        </svg>
      );
    case 'home':
      return (
        <svg {...p}>
          <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z" />
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
    case 'signal':
      return (
        <svg {...p}>
          <path d="M4 18v-2M9 18v-6M14 18v-10M19 18V4" />
        </svg>
      );
    case 'nosignal':
      return (
        <svg {...p}>
          <path d="M4 18v-2M9 18v-6M14 18v-3M19 18V4" />
          <path d="M3 21L21 3" />
        </svg>
      );
    case 'send':
      return (
        <svg {...p}>
          <path d="M3 12l18-8-7 18-3-7-8-3Z" />
        </svg>
      );
    case 'x':
      return (
        <svg {...p}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...p}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'minus':
      return (
        <svg {...p}>
          <path d="M5 12h14" />
        </svg>
      );
    case 'edit':
      return (
        <svg {...p}>
          <path d="M4 20h4l10-10-4-4L4 16Z" />
          <path d="M14 6l4 4" />
        </svg>
      );
    case 'dot':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="3" fill={color} stroke="none" />
        </svg>
      );
    case 'info':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8v.5" />
        </svg>
      );
    case 'search':
      return (
        <svg {...p}>
          <circle cx="11" cy="11" r="6" />
          <path d="M20 20l-4.5-4.5" />
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
