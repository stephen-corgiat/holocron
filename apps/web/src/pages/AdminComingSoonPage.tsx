import { AdminNavId, AdminShell } from '../admin/AdminShell';

interface Props {
  active: AdminNavId;
  title: string;
  subtitle?: string;
  blurb: string;
  issueRef?: string;
}

export function AdminComingSoonPage({ active, title, subtitle, blurb, issueRef }: Props) {
  return (
    <AdminShell active={active} title={title} subtitle={subtitle}>
      <div className="admin-coming-soon">
        <span className="admin-coming-soon-eyebrow">Not yet implemented</span>
        <h2 className="admin-coming-soon-title">{title}</h2>
        <p className="admin-coming-soon-body">{blurb}</p>
        {issueRef && (
          <p className="admin-coming-soon-body" style={{ opacity: 0.55 }}>
            Tracked in {issueRef}.
          </p>
        )}
      </div>
    </AdminShell>
  );
}
