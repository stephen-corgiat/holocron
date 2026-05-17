import { TrackeeView } from '../../auth/api';
import { Icon } from '../icons/Icon';

interface Props {
  trackees: TrackeeView[];
  activeId: string | null;
  onPick: (id: string) => void;
  restrictedUserIds: Set<string>;
  awayUserIds: Set<string>;
  disabled?: boolean;
}

export function TrackeeTabBar({
  trackees,
  activeId,
  onPick,
  restrictedUserIds,
  awayUserIds,
  disabled,
}: Props) {
  if (trackees.length === 0) {
    return (
      <div className="tb-tabbar tb-tabbar-empty">No active Trackees yet.</div>
    );
  }
  return (
    <div className="tb-tabbar" role="tablist">
      {trackees.map((t) => {
        const on = t.id === activeId;
        const initial = (t.display_name[0] ?? '?').toUpperCase();
        const restricted = restrictedUserIds.has(t.id);
        const away = awayUserIds.has(t.id);
        const streak = on ? (t.current_streak ?? 0) : 0;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            className={`tb-tab ${on ? 'is-on' : ''}`}
            onClick={() => onPick(t.id)}
            disabled={disabled}
          >
            <span
              className="tb-tab-avatar"
              style={{ background: t.color ?? '#7adff0' }}
            >
              {initial}
            </span>
            <span className="tb-tab-name">{t.display_name}</span>
            {restricted && (
              <span
                className="tb-tab-icon tb-tab-lock"
                title="Restriction active"
              >
                <Icon name="lock" size={13} stroke={2.4} />
              </span>
            )}
            {away && (
              <span className="tb-tab-icon tb-tab-away" title="Away">
                <Icon name="away" size={13} stroke={2.2} />
              </span>
            )}
            {on && streak > 0 && (
              <span className="tb-tab-streak" title="Daily-routine streak">
                <Icon name="fire" size={12} stroke={2.2} />
                {streak}
              </span>
            )}
            {t.is_admin && <span className="tb-tab-admin">ADMIN</span>}
          </button>
        );
      })}
    </div>
  );
}
