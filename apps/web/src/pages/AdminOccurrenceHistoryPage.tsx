import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useHouseholdTimeZone } from '../settings/SettingsProvider';
import { isoDateInTz } from '../lib/datetime';
import { useSocket } from '../hooks/useSocket';
import {
  AdminOccurrenceRow,
  TrackeeView,
  adminOccurrencesApi,
  usersApi,
} from '../auth/api';
import { AdminShell } from '../admin/AdminShell';

export function AdminOccurrenceHistoryPage() {
  const { session } = useAuth();
  const tz = useHouseholdTimeZone();
  const adminToken = session.kind === 'admin' ? session.token : null;
  const { on } = useSocket(adminToken);
  const { trackeeId } = useParams<{ trackeeId: string }>();
  const navigate = useNavigate();

  const [trackees, setTrackees] = useState<TrackeeView[]>([]);
  const selectedUserId = trackeeId ?? '';
  const [rows, setRows] = useState<AdminOccurrenceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadTrackees = useCallback(async () => {
    if (!adminToken) return;
    try {
      const { trackees: next } = await usersApi.list(adminToken);
      const active = next.filter((t) => !t.deactivated_at);
      setTrackees(active);
      if (!trackeeId && active.length > 0) {
        navigate(`/admin/users/${active[0].id}/history`, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load Trackees');
    }
  }, [adminToken, trackeeId, navigate]);

  const loadRows = useCallback(async () => {
    if (!adminToken || !selectedUserId) return;
    try {
      const { occurrences } = await adminOccurrencesApi.forTrackee(
        adminToken,
        selectedUserId,
      );
      setRows(occurrences);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load history');
    }
  }, [adminToken, selectedUserId]);

  useEffect(() => {
    void loadTrackees();
  }, [loadTrackees]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    const off = on('tasks:changed', () => void loadRows());
    return off;
  }, [on, loadRows]);

  const excuse = async (occurrenceId: string) => {
    if (!adminToken) return;
    setBusy(occurrenceId);
    setError(null);
    try {
      await adminOccurrencesApi.excuse(adminToken, occurrenceId);
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'excuse failed');
    } finally {
      setBusy(null);
    }
  };

  const defer = async (occurrenceId: string) => {
    if (!adminToken) return;
    const input = window.prompt(
      'Defer to which date? (YYYY-MM-DD)',
      isoDateInTz(new Date(Date.now() + 86400_000), tz),
    );
    if (!input) return;
    setBusy(occurrenceId);
    setError(null);
    try {
      await adminOccurrencesApi.defer(adminToken, occurrenceId, input);
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'defer failed');
    } finally {
      setBusy(null);
    }
  };

  if (session.kind !== 'admin') return null;

  const currentTrackee = trackees.find((t) => t.id === selectedUserId);
  const title = currentTrackee
    ? `${currentTrackee.display_name} · history`
    : 'Occurrence history';

  return (
    <AdminShell
      active="users"
      title={title}
      subtitle="Trailing 30 days · Excuse / Defer eligible"
      actions={
        <>
          <Link to="/admin/users" className="logout-button" style={{ textDecoration: 'none' }}>
            ← Users
          </Link>
          {trackees.length > 1 && (
            <select
              value={selectedUserId}
              onChange={(e) => navigate(`/admin/users/${e.target.value}/history`)}
            >
              {trackees.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.display_name}
                </option>
              ))}
            </select>
          )}
        </>
      }
    >
      {error && <p className="auth-error">{error}</p>}

      <ul className="trackee-list">
        {rows.length === 0 && (
          <li className="trackee-row" style={{ opacity: 0.6 }}>
            No occurrences in the trailing 30 days.
          </li>
        )}
        {rows.map((row) => {
          const eligible =
            row.status === 'active' ||
            row.status === 'missed' ||
            row.status === 'pending_review';
          return (
            <li key={row.id} className="trackee-row">
              <div className="trackee-row-main">
                <div>
                  <div className="trackee-name">
                    {row.task_icon && (
                      <span style={{ marginRight: 6 }}>{row.task_icon}</span>
                    )}
                    {row.task_name}
                    <span className="badge" style={{ marginLeft: 6 }}>
                      {row.status}
                    </span>
                    {row.deferred_from_occurrence_id && (
                      <span className="badge" style={{ marginLeft: 6 }}>
                        deferred
                      </span>
                    )}
                  </div>
                  <div className="trackee-meta">
                    {formatWhen(row.scheduled_at, tz)} · {row.task_points} pts
                  </div>
                </div>
              </div>
              <div className="trackee-row-actions">
                {eligible && (
                  <>
                    <button
                      type="button"
                      className="logout-button"
                      onClick={() => excuse(row.id)}
                      disabled={busy !== null}
                    >
                      Excuse
                    </button>
                    <button
                      type="button"
                      className="logout-button"
                      onClick={() => defer(row.id)}
                      disabled={busy !== null}
                    >
                      Defer
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </AdminShell>
  );
}

function formatWhen(iso: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
