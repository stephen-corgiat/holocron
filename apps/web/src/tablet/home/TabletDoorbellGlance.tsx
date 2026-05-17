import { Icon } from '../icons/Icon';
import { HomeGlyph } from './glyphs';
import { CameraView } from './ha-source';
import { CameraTile } from './CameraTile';
import { resolveGlanceCameras } from './doorbell-glance';
import { wallClockInTz } from '../../lib/datetime';

/**
 * The doorbell glance overlay: a modal
 * over the dimmed routine that auto-surfaces the **front-door** camera on a
 * doorbell press, with the other cameras as a picker plus a manual Dismiss.
 * Open/auto-close/reset state is owned by
 * `useDoorbellGlance`; this component is purely presentational and reuses the
 * `CameraTile` hotlink `<img>` for every frame, so the doorbell
 * view is the same live 5s-refresh snapshot as the Home grid.
 */
export function TabletDoorbellGlance({
  cameras,
  width,
  rangAt,
  focusCameraId,
  tz,
  onPick,
  onDismiss,
}: {
  cameras: CameraView[];
  /** The one canonical hotlink width. */
  width: number;
  /** ISO timestamp of the press, for the RANG label. */
  rangAt: string | null;
  /** The camera id focused as the big frame (null ⇒ default to the doorbell). */
  focusCameraId: string | null;
  /** Household timezone for the 12-hour RANG label (ADR-0007). */
  tz: string;
  onPick: (cameraId: string) => void;
  onDismiss: () => void;
}) {
  const { focus, others } = resolveGlanceCameras(cameras, focusCameraId);
  if (!focus) return null;

  const rangLabel = rangAt ? wallClockInTz(rangAt, tz) : null;

  return (
    <div
      className="ha-doorbell-glance"
      data-rang-at={rangAt ?? undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Doorbell — someone's at the front door"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {/* scrim over the dimmed routine */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(4,8,10,.62)',
          backdropFilter: 'blur(2px)',
        }}
      />

      {/* glance card */}
      <div
        style={{
          position: 'relative',
          width: 'min(820px, 92vw)',
          maxHeight: '92vh',
          overflow: 'auto',
          background: 'var(--tb-surface)',
          border: '1px solid var(--tb-primary-soft)',
          borderRadius: 16,
          padding: 18,
          boxShadow: '0 40px 90px rgba(0,0,0,.6), var(--tb-glow)',
        }}
      >
        {/* header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 11,
              background: 'var(--tb-primary-soft)',
              color: 'var(--tb-primary)',
              display: 'grid',
              placeItems: 'center',
              border: '1px solid var(--tb-primary-soft)',
            }}
          >
            <HomeGlyph name="doorbell" size={22} stroke={2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'var(--tb-font-mono)',
                fontSize: 10,
                fontWeight: 800,
                color: 'var(--tb-primary)',
                letterSpacing: 1.2,
              }}
            >
              DOORBELL · SOMEONE'S AT THE FRONT DOOR
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 800,
                color: 'var(--tb-ink)',
                marginTop: 3,
              }}
            >
              {focus.name}
            </div>
          </div>
          {rangLabel && (
            <div
              style={{
                fontFamily: 'var(--tb-font-mono)',
                fontSize: 11,
                color: 'var(--tb-muted)',
                letterSpacing: 0.4,
              }}
            >
              RANG · {rangLabel}
            </div>
          )}
          <button
            type="button"
            aria-label="Close"
            onClick={onDismiss}
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              border: '1px solid var(--tb-line)',
              background: 'var(--tb-surface2)',
              color: 'var(--tb-ink2)',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Icon name="x" size={18} stroke={2.4} />
          </button>
        </div>

        {/* big focused frame */}
        <CameraTile
          key={focus.id}
          camera={focus}
          width={width}
          visible
          big
          style={{ height: 384 }}
        />

        {/* other cameras as a picker + Dismiss */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 14,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--tb-font-mono)',
              fontSize: 10,
              color: 'var(--tb-muted)',
              fontWeight: 800,
              letterSpacing: 0.8,
              textTransform: 'uppercase',
              flexShrink: 0,
            }}
          >
            Other cameras
          </span>
          <div
            className="ha-doorbell-picker"
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.max(1, others.length)}, 1fr)`,
              gap: 10,
              flex: 1,
            }}
          >
            {others.map((cam) => (
              <button
                key={cam.id}
                type="button"
                aria-label={`View ${cam.name}`}
                data-camera-id={cam.id}
                onClick={() => onPick(cam.id)}
                style={{
                  padding: 0,
                  border: 0,
                  background: 'transparent',
                  cursor: 'pointer',
                  borderRadius: 12,
                }}
              >
                <CameraTile camera={cam} width={width} visible style={{ height: 86 }} />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onDismiss}
            style={{
              padding: '12px 20px',
              border: 0,
              borderRadius: 9,
              background: 'var(--tb-primary)',
              color: '#0b1417',
              fontFamily: 'var(--tb-font-mono)',
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 1,
              textTransform: 'uppercase',
              cursor: 'pointer',
              boxShadow: 'var(--tb-glow)',
              flexShrink: 0,
              alignSelf: 'stretch',
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
