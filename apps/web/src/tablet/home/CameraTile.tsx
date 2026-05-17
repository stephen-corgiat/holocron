import { CSSProperties } from 'react';
import { Icon } from '../icons/Icon';
import { HomeGlyph } from './glyphs';
import { CameraView } from './ha-source';
import { CameraState } from './camera-status';
import { useCameraFrame } from './useCameraFrame';

/**
 * Per-tint scene gradients. Keyed by a camera's first id token so a
 * configured `front`/`drive`/`yard`/`garage` camera picks the matching tint;
 * anything else falls back to `drive`. The gradient is only the *backdrop*
 * behind the live `<img>` — visible during load and around any letterboxing.
 */
export const CAM_TINTS: Record<string, string> = {
  door: 'radial-gradient(120% 90% at 50% 120%, rgba(255,179,0,.22), rgba(8,14,18,0) 55%), linear-gradient(180deg, #16222b, #0a1014)',
  drive: 'radial-gradient(100% 80% at 80% 0%, rgba(0,229,255,.12), rgba(8,14,18,0) 60%), linear-gradient(180deg, #0e1820, #070d11)',
  yard: 'radial-gradient(120% 90% at 20% 10%, rgba(124,140,255,.14), rgba(8,14,18,0) 55%), linear-gradient(180deg, #101b1a, #070d0c)',
  garage: 'linear-gradient(180deg, #14181c, #0a0d10)',
};

/** Pick a tint from the camera id/name (e.g. `front_door` → `door`). */
export function tintFor(cam: CameraView): string {
  const hay = `${cam.id} ${cam.name}`.toLowerCase();
  if (cam.doorbell || hay.includes('door')) return CAM_TINTS.door;
  if (hay.includes('drive')) return CAM_TINTS.drive;
  if (hay.includes('yard') || hay.includes('back')) return CAM_TINTS.yard;
  if (hay.includes('garage')) return CAM_TINTS.garage;
  return CAM_TINTS.drive;
}

export function ageLabel(state: CameraState, now: number): string {
  if (state.lastGoodAt === null) return '…';
  const secs = Math.max(0, Math.round((now - state.lastGoodAt) / 1000));
  return `${secs}s`;
}

interface CameraTileProps {
  camera: CameraView;
  /** The single canonical width to request from the hotlink URL. */
  width: number;
  /**
   * Only `visible` tiles run their refresh timer. A hidden tile keeps its last frame and pauses swapping.
   */
  visible?: boolean;
  big?: boolean;
  onExpand?: () => void;
  style?: CSSProperties;
}

/**
 * A single camera snapshot tile. Owns a visible
 * `<img>` (the last frame that loaded) plus a hidden probe `<img>` that fetches
 * the next frame every 5s; the probe only promotes to the visible frame
 * on a successful load (useCameraFrame), so a failed refresh never blanks the
 * tile. Freshness is FE-derived from those load/error events (camera-status.ts)
 * — there is no server `ageMs`.
 */
export function CameraTile({
  camera,
  width,
  visible = true,
  big,
  onExpand,
  style,
}: CameraTileProps) {
  const { goodSrc, probeSrc, status, state, now, onProbeLoad, onProbeError } =
    useCameraFrame(camera.urlTemplate, width, visible);
  const offline = status === 'offline';
  const stale = status === 'stale';

  const badge = offline
    ? { color: 'var(--tb-danger)', label: 'OFFLINE', dot: 'var(--tb-danger)' }
    : stale
      ? { color: 'var(--tb-warn)', label: `STALE · ${ageLabel(state, now)}`, dot: 'var(--tb-warn)' }
      : { color: 'var(--tb-primary)', label: ageLabel(state, now), dot: 'var(--tb-primary)' };

  return (
    <div
      className="hc-scan ha-camera-tile"
      data-camera-id={camera.id}
      data-camera-status={status}
      style={{
        position: 'relative',
        borderRadius: 12,
        overflow: 'hidden',
        background: tintFor(camera),
        border: `1px solid ${camera.doorbell ? 'rgba(0,229,255,.27)' : 'var(--tb-line)'}`,
        boxShadow: camera.doorbell ? 'var(--tb-glow)' : 'inset 0 0 60px rgba(0,0,0,.5)',
        filter: offline
          ? 'grayscale(1) brightness(.55)'
          : stale
            ? 'saturate(.7) brightness(.92)'
            : 'none',
        ...style,
      }}
    >
      {/* the visible snapshot — the last frame that loaded. Explicit display
          sizing; the browser downscales the single canonical-width frame per
          surface. Hidden while offline (placeholder takes over). */}
      {goodSrc !== undefined && (
        <img
          className="ha-camera-frame"
          src={goodSrc}
          alt={camera.name}
          width="100%"
          height="100%"
          draggable={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: offline ? 'none' : 'block',
          }}
        />
      )}

      {/* hidden probe — loads the next candidate frame; promoted on success. */}
      {probeSrc !== undefined && probeSrc !== goodSrc && (
        <img
          src={probeSrc}
          alt=""
          aria-hidden="true"
          width={1}
          height={1}
          onLoad={onProbeLoad}
          onError={onProbeError}
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />
      )}

      {/* lens vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          boxShadow: 'inset 0 0 80px rgba(0,0,0,.65)',
          pointerEvents: 'none',
        }}
      />

      {/* freshness / status badge */}
      <div
        className="ha-camera-badge"
        style={{
          position: 'absolute',
          top: 9,
          right: 9,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          borderRadius: 999,
          background: 'rgba(7,10,12,.7)',
          border: `1px solid ${badge.color}`,
          fontFamily: 'var(--tb-font-mono)',
          fontSize: big ? 11 : 9,
          fontWeight: 800,
          color: badge.color,
          letterSpacing: 0.5,
        }}
      >
        <span
          className={status === 'fresh' ? 'hc-pulse' : ''}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: badge.dot,
            boxShadow: `0 0 6px ${badge.dot}`,
          }}
        />
        {badge.label}
      </div>

      {camera.doorbell && !offline && (
        <div
          style={{
            position: 'absolute',
            top: 9,
            left: 9,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px',
            borderRadius: 999,
            background: 'rgba(7,10,12,.7)',
            border: '1px solid var(--tb-primary)',
            fontFamily: 'var(--tb-font-mono)',
            fontSize: big ? 11 : 9,
            fontWeight: 800,
            color: 'var(--tb-primary)',
            letterSpacing: 0.5,
          }}
        >
          <HomeGlyph name="doorbell" size={big ? 13 : 11} stroke={2.2} /> DOORBELL
        </div>
      )}

      {offline && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
          }}
        >
          <div>
            <Icon name="nosignal" size={big ? 36 : 26} color="var(--tb-danger)" stroke={2} />
            <div
              style={{
                fontFamily: 'var(--tb-font-mono)',
                fontSize: big ? 12 : 10,
                fontWeight: 800,
                color: 'var(--tb-ink2)',
                letterSpacing: 1,
                marginTop: 8,
              }}
            >
              CAMERA OFFLINE
            </div>
            <div
              style={{
                fontFamily: 'var(--tb-font-mono)',
                fontSize: 9,
                color: 'var(--tb-muted)',
                marginTop: 4,
                letterSpacing: 0.4,
              }}
            >
              LAST FRAME · {ageLabel(state, now)} AGO
            </div>
          </div>
        </div>
      )}

      {/* label bar */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: big ? '26px 14px 12px' : '20px 11px 9px',
          background: 'linear-gradient(180deg, rgba(7,10,12,0), rgba(7,10,12,.85))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: big ? 16 : 13,
            fontWeight: 800,
            color: 'var(--tb-ink)',
            letterSpacing: -0.1,
          }}
        >
          {camera.name}
        </span>
        {onExpand && !offline && (
          <button
            type="button"
            aria-label={`Expand ${camera.name}`}
            onClick={onExpand}
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              border: '1px solid rgba(236,239,241,.18)',
              background: 'rgba(7,10,12,.5)',
              color: 'var(--tb-ink2)',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              <path d="M7 1h4v4M5 11H1V7M11 1L7.5 4.5M1 11l3.5-3.5" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
