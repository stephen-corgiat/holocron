import { CSSProperties } from 'react';
import { CameraView } from './ha-source';
import { tintFor } from './CameraTile';
import { useCameraFrame } from './useCameraFrame';

/**
 * The dock's compact 4-up camera filmstrip.
 * Same data + same hotlink path as the Home-view grid — each thumbnail is
 * a live `<img>` that swaps its `src` every 5s at the **one canonical width**
 * (the box downscales to the thumb size; we never request a thumb-sized
 * frame). Tapping any thumbnail opens the full Home view. Refreshes pause when
 * the dock is off-screen (`visible=false`).
 */
export function CameraFilmstrip({
  cameras,
  width,
  visible = true,
  onOpen,
}: {
  cameras: CameraView[];
  width: number;
  visible?: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="ha-camera-filmstrip" style={{ display: 'flex', gap: 6 }}>
      {cameras.map((cam) => (
        <FilmstripThumb
          key={cam.id}
          camera={cam}
          width={width}
          visible={visible}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

const THUMB_STYLE: CSSProperties = {
  width: 74,
  height: 70,
  borderRadius: 8,
  overflow: 'hidden',
  position: 'relative',
  padding: 0,
  cursor: 'pointer',
};

function FilmstripThumb({
  camera,
  width,
  visible,
  onOpen,
}: {
  camera: CameraView;
  width: number;
  visible: boolean;
  onOpen: () => void;
}) {
  const { goodSrc, probeSrc, status, onProbeLoad, onProbeError } = useCameraFrame(
    camera.urlTemplate,
    width,
    visible,
  );
  const offline = status === 'offline';
  const stale = status === 'stale';
  const dot = offline
    ? 'var(--tb-danger)'
    : stale
      ? 'var(--tb-warn)'
      : 'var(--tb-primary)';
  const shortLabel = camera.doorbell
    ? 'DOOR'
    : camera.name.split(' ')[0].toUpperCase();

  return (
    <button
      type="button"
      className="hc-scan ha-camera-thumb"
      data-camera-id={camera.id}
      data-camera-status={status}
      title={camera.name}
      aria-label={`Open ${camera.name}`}
      onClick={onOpen}
      style={{
        ...THUMB_STYLE,
        background: tintFor(camera),
        border: `1px solid ${camera.doorbell ? 'rgba(0,229,255,.4)' : 'var(--tb-line)'}`,
        boxShadow: camera.doorbell ? 'var(--tb-glow)' : 'inset 0 0 24px rgba(0,0,0,.5)',
        filter: offline
          ? 'grayscale(1) brightness(.55)'
          : stale
            ? 'saturate(.7) brightness(.92)'
            : 'none',
      }}
    >
      {goodSrc !== undefined && (
        <img
          className="ha-camera-frame"
          src={goodSrc}
          alt={camera.name}
          width={74}
          height={70}
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
      <span
        style={{
          position: 'absolute',
          inset: 0,
          boxShadow: 'inset 0 0 22px rgba(0,0,0,.6)',
          pointerEvents: 'none',
        }}
      />
      <span
        className={status === 'fresh' ? 'hc-pulse' : ''}
        style={{
          position: 'absolute',
          top: 4,
          right: 4,
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: dot,
          boxShadow: `0 0 5px ${dot}`,
        }}
      />
      <span
        style={{
          position: 'absolute',
          left: 5,
          bottom: 3,
          fontSize: 7.5,
          fontWeight: 700,
          color: 'var(--tb-ink)',
          fontFamily: 'var(--tb-font-mono)',
          letterSpacing: 0.2,
          textShadow: '0 1px 2px #000',
        }}
      >
        {shortLabel}
      </span>
    </button>
  );
}
