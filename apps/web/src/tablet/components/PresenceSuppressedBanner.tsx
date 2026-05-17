import { Glyph } from '../icons/Glyph';
import { TrackeeView } from '../../auth/api';

interface Props {
  trackee: TrackeeView;
  nextReturn: string | null;
  vacationLabel?: string | null;
  otherTrackees: TrackeeView[];
  onPickOther: (id: string) => void;
}

export function PresenceSuppressedBanner({
  trackee,
  nextReturn,
  vacationLabel,
  otherTrackees,
  onPickOther,
}: Props) {
  const fallback = otherTrackees.find((t) => t.id !== trackee.id) ?? null;
  return (
    <div className="tb-presence-screen" role="status">
      <div className="tb-presence-card">
        <div style={{ margin: '0 auto 18px', width: 88, height: 88 }}>
          <Glyph
            name="cube"
            size={88}
            color="var(--tb-primary)"
            stroke={1.4}
          />
        </div>
        <div className="tb-presence-eyebrow">Presence-suppressed</div>
        <div className="tb-presence-title">{trackee.display_name} is away.</div>
        <div className="tb-presence-body">
          Routines are paused while {trackee.display_name} is away — goals stay
          available, and the daily-routine streak is preserved.
        </div>
        <div className="tb-presence-info">
          {nextReturn && (
            <div>
              <span className="label">Away until · </span>
              <span className="v">{nextReturn}</span>
            </div>
          )}
          <div>
            <span className="label">Via · </span>
            <span className="v">
              {vacationLabel ?? 'Recurring presence grid'}
            </span>
          </div>
        </div>
        {fallback && (
          <div className="tb-presence-cta">
            <button
              type="button"
              className="tb-dialog-btn is-primary"
              onClick={() => onPickOther(fallback.id)}
            >
              Switch to {fallback.display_name}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
