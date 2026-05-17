import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useHouseholdTimeZone } from '../settings/SettingsProvider';
import { AdminShell } from '../admin/AdminShell';
import { CashOutRequestView, transactionsApi } from '../auth/api';
import { useSocket } from '../hooks/useSocket';

export function AdminCashOutQueuePage() {
  const { session } = useAuth();
  const tz = useHouseholdTimeZone();
  const adminToken = session.kind === 'admin' ? session.token : null;
  const { on } = useSocket(adminToken);

  const [rate, setRate] = useState(0.1);
  const [requests, setRequests] = useState<CashOutRequestView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!adminToken) return;
    try {
      const { requests: next } = await transactionsApi.listCashOutRequests(
        adminToken,
      );
      setRequests(next);
      setError(null);
      if (next.length > 0) {
        // Best-effort rate fetch from any user balance call. Cheap & idempotent.
        const r = await transactionsApi.balance(adminToken, next[0].user_id);
        setRate(r.cash_out_rate);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load');
    }
  }, [adminToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const off = on('transactions:changed', () => void refresh());
    return off;
  }, [on, refresh]);

  if (session.kind !== 'admin') return null;

  const onCommit = async (id: string) => {
    if (!adminToken) return;
    setBusyId(id);
    try {
      await transactionsApi.commitCashOutRequest(adminToken, id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'commit failed');
    } finally {
      setBusyId(null);
    }
  };

  const onReject = async (id: string) => {
    if (!adminToken) return;
    if (!confirm('Reject this cash-out request?')) return;
    setBusyId(id);
    try {
      await transactionsApi.rejectCashOutRequest(adminToken, id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'reject failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AdminShell
      active="cashout"
      title="Cash-out queue"
      subtitle={
        requests.length === 0
          ? 'No pending requests'
          : `${requests.length} pending`
      }
    >
      {error && <p className="auth-error">{error}</p>}
      {requests.length === 0 ? (
        <p className="auth-prose">
          Trackees can request a cash-out from the tablet. Pending requests
          appear here for you to commit or reject. Direct admin cash-outs from
          the Users page bypass this queue.
        </p>
      ) : (
        <ul className="trackee-list">
          {requests.map((r) => (
            <li key={r.id} className="trackee-row">
              <div className="trackee-row-main">
                <div>
                  <div className="trackee-name">{r.user_display_name}</div>
                  <div className="trackee-meta">
                    Requested {r.requested_amount} points (≈ ${
                      (r.requested_amount * rate).toFixed(2)
                    }) ·{' '}
                    {new Date(r.created_at).toLocaleString(undefined, {
                      timeZone: tz,
                      hour12: true,
                    })}
                  </div>
                </div>
              </div>
              <div className="trackee-row-actions">
                <button
                  type="button"
                  className="auth-submit"
                  disabled={busyId === r.id}
                  onClick={() => onCommit(r.id)}
                >
                  Commit
                </button>
                <button
                  type="button"
                  className="logout-button"
                  disabled={busyId === r.id}
                  onClick={() => onReject(r.id)}
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AdminShell>
  );
}
