import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useSocket } from '../hooks/useSocket';
import { PendingCard, adminOccurrencesApi, pendingReviewApi } from '../auth/api';
import { AdminShell } from '../admin/AdminShell';
import { useHouseholdTimeZone } from '../settings/SettingsProvider';
import { isoDateInTz } from '../lib/datetime';

export function AdminPendingReviewPage() {
  const { session } = useAuth();
  const tz = useHouseholdTimeZone();
  const adminToken = session.kind === 'admin' ? session.token : null;
  const { on } = useSocket(adminToken);

  const [pending, setPending] = useState<PendingCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!adminToken) return;
    try {
      const { pending: rows } = await pendingReviewApi.list(adminToken);
      setPending(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load pending review');
    }
  }, [adminToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const off = on('tasks:changed', () => void refresh());
    return off;
  }, [on, refresh]);

  const approve = async (occurrenceId: string) => {
    if (!adminToken) return;
    setBusy(occurrenceId);
    setError(null);
    try {
      await pendingReviewApi.approve(adminToken, occurrenceId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'approve failed');
    } finally {
      setBusy(null);
    }
  };

  const reject = async (occurrenceId: string) => {
    if (!adminToken) return;
    setBusy(occurrenceId);
    setError(null);
    try {
      await pendingReviewApi.reject(adminToken, occurrenceId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'reject failed');
    } finally {
      setBusy(null);
    }
  };

  const excuse = async (occurrenceId: string) => {
    if (!adminToken) return;
    setBusy(occurrenceId);
    setError(null);
    try {
      await adminOccurrencesApi.excuse(adminToken, occurrenceId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'excuse failed');
    } finally {
      setBusy(null);
    }
  };

  const defer = async (occurrenceId: string) => {
    if (!adminToken) return;
    const promptDefault = isoDateInTz(new Date(Date.now() + 86400_000), tz);
    const input = window.prompt(
      'Defer to which date? (YYYY-MM-DD)',
      promptDefault,
    );
    if (!input) return;
    setBusy(occurrenceId);
    setError(null);
    try {
      await adminOccurrencesApi.defer(adminToken, occurrenceId, input);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'defer failed');
    } finally {
      setBusy(null);
    }
  };

  const approveAll = async () => {
    if (!adminToken) return;
    if (pending.length === 0) return;
    if (!confirm(`Approve all ${pending.length} pending review card(s)?`)) return;
    setBusy('all');
    setError(null);
    try {
      await pendingReviewApi.approveAll(adminToken);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'approve all failed');
    } finally {
      setBusy(null);
    }
  };

  if (session.kind !== 'admin') return null;

  const subtitle =
    pending.length === 0
      ? 'No pending cards'
      : `${pending.length} card${pending.length === 1 ? '' : 's'} awaiting approval`;

  return (
    <AdminShell
      active="pending"
      title="Pending review"
      subtitle={subtitle}
      actions={
        pending.length > 0 ? (
          <button
            type="button"
            className="auth-submit"
            onClick={approveAll}
            disabled={busy !== null}
          >
            Approve all ({pending.length})
          </button>
        ) : null
      }
    >
      {error && <p className="auth-error">{error}</p>}

      <ul className="trackee-list">
        {pending.length === 0 && (
          <li className="trackee-row" style={{ opacity: 0.6 }}>
            Nothing waiting on review. Verifiable tasks marked done by a Trackee
            show up here for Approve / Reject.
          </li>
        )}
        {pending.map((card) => (
          <li key={card.occurrence_id} className="trackee-row">
            <div className="trackee-row-main">
              <div>
                <div className="trackee-name">
                  {card.task_icon && (
                    <span style={{ marginRight: 6 }}>{card.task_icon}</span>
                  )}
                  {card.task_name}
                  <span className="badge" style={{ marginLeft: 6 }}>
                    {card.user_display_name}
                  </span>
                </div>
                <div className="trackee-meta">
                  Points already credited: {card.task_points} · pending since{' '}
                  {formatWhen(card.pending_since, tz)}
                </div>
              </div>
            </div>
            <div className="trackee-row-actions">
              <button
                type="button"
                className="auth-submit"
                onClick={() => approve(card.occurrence_id)}
                disabled={busy !== null}
              >
                Approve
              </button>
              <button
                type="button"
                className="logout-button"
                onClick={() => reject(card.occurrence_id)}
                disabled={busy !== null}
              >
                Reject
              </button>
              <button
                type="button"
                className="logout-button"
                onClick={() => excuse(card.occurrence_id)}
                disabled={busy !== null}
              >
                Excuse
              </button>
              <button
                type="button"
                className="logout-button"
                onClick={() => defer(card.occurrence_id)}
                disabled={busy !== null}
              >
                Defer
              </button>
            </div>
          </li>
        ))}
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
