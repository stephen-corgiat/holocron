interface Props {
  time: string;
  date: string;
  status: 'connected' | 'connecting' | 'disconnected';
}

export function TabletStatusBar({ time, date, status }: Props) {
  const linkLabel =
    status === 'connected'
      ? 'LINK'
      : status === 'connecting'
        ? 'LINK · …'
        : 'NO LINK';
  return (
    <div className="tb-status-bar">
      <div className="tb-status-bar-left">
        HOLOCRON · NODE · {date}
      </div>
      <div className="tb-status-bar-right">
        <span>{time}</span>
        <span className={`tb-status-link ${status}`}>· {linkLabel}</span>
      </div>
    </div>
  );
}
