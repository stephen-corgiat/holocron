import { CSSProperties } from 'react';
import { Glyph } from '../icons/Glyph';
import { HaPanel } from './HaPanel';
import { HaSnapshot } from './ha-source';

type Weather = NonNullable<HaSnapshot['weather']>;

/**
 * Display-only weather panel: sun glyph, current
 * temp + condition, LO/HI from the cached forecast. Renders only when `weather`
 * is present. Offline, or present-but-thin (no current temp yet), shows
 * the calm "No weather data" state.
 */
export function WeatherPanel({
  weather,
  style,
}: {
  weather: Weather;
  style?: CSSProperties;
}) {
  const tempNow = weather.avail === 'unavailable' ? undefined : weather.tempNow;
  const noData = tempNow === undefined;
  return (
    <HaPanel glyph="cloud" title="Weather" style={style}>
      {noData ? (
        <div
          style={{
            display: 'grid',
            placeItems: 'center',
            height: '100%',
            padding: '20px 14px',
            textAlign: 'center',
          }}
        >
          <div>
            <div
              style={{
                fontFamily: 'var(--tb-font-mono)',
                fontSize: 30,
                fontWeight: 800,
                color: 'var(--tb-muted)',
              }}
            >
              —
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--tb-muted)',
                marginTop: 4,
                fontFamily: 'var(--tb-font-mono)',
                letterSpacing: 0.3,
              }}
            >
              No weather data
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 16px',
          }}
        >
          <span
            style={{
              color: 'var(--tb-warn)',
              display: 'inline-flex',
              flexShrink: 0,
            }}
          >
            <Glyph name="sun" size={40} color="currentColor" />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span
                style={{
                  fontFamily: 'var(--tb-font-mono)',
                  fontSize: 28,
                  fontWeight: 800,
                  color: 'var(--tb-ink)',
                  lineHeight: 1,
                }}
              >
                {Math.round(tempNow)}°
              </span>
              {weather.condition && (
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tb-ink2)' }}>
                  {weather.condition}
                </span>
              )}
            </div>
            {(weather.tempLow !== undefined || weather.tempHigh !== undefined) && (
              <div
                style={{
                  display: 'flex',
                  gap: 14,
                  marginTop: 8,
                  fontFamily: 'var(--tb-font-mono)',
                  fontSize: 11,
                  letterSpacing: 0.4,
                }}
              >
                {weather.tempLow !== undefined && (
                  <span style={{ color: 'var(--tb-muted)' }}>
                    LO{' '}
                    <span style={{ color: 'var(--tb-ink2)', fontWeight: 700 }}>
                      {Math.round(weather.tempLow)}°
                    </span>
                  </span>
                )}
                {weather.tempHigh !== undefined && (
                  <span style={{ color: 'var(--tb-muted)' }}>
                    HI{' '}
                    <span style={{ color: 'var(--tb-ink2)', fontWeight: 700 }}>
                      {Math.round(weather.tempHigh)}°
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </HaPanel>
  );
}
