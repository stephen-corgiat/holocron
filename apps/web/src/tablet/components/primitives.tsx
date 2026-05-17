import { CSSProperties, ReactNode } from 'react';

export function Card({
  children,
  className,
  style,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  return (
    <div
      className={`tb-card ${className ?? ''}`}
      style={style}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      {children}
    </div>
  );
}

export function Pill({
  children,
  tone = 'muted',
  className,
  style,
}: {
  children: ReactNode;
  tone?: 'primary' | 'warn' | 'danger' | 'accent' | 'muted' | 'info';
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={`tb-pill tone-${tone} ${className ?? ''}`} style={style}>
      {children}
    </span>
  );
}

export function Chip({
  children,
  on,
  onClick,
  disabled,
}: {
  children: ReactNode;
  on?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`tb-chip ${on ? 'is-on' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function SectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`tb-section-label ${className ?? ''}`}>{children}</div>;
}

export function Ring({
  size = 80,
  stroke = 8,
  value = 0.6,
  color = 'var(--tb-primary)',
  track = 'var(--tb-line2)',
  children,
}: {
  size?: number;
  stroke?: number;
  value?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div
      style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}
    >
      <svg
        width={size}
        height={size}
        style={{ transform: 'rotate(-90deg)' }}
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={track}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={`${c * Math.min(1, Math.max(0, value))} ${c}`}
          strokeLinecap="round"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        {children}
      </div>
    </div>
  );
}
