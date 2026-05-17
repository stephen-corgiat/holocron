import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useSocket } from '../hooks/useSocket';
import {
  TrackeeView,
  TransactionView,
  transactionsApi,
  usersApi,
} from '../auth/api';
import { AdminShell } from '../admin/AdminShell';
import { TransactionList } from '../components/TransactionList';
import { useHouseholdTimeZone } from '../settings/SettingsProvider';
import { utcInstantInTz } from '../lib/datetime';
import '../tablet/tablet.css';

type FilterKind = 'all' | 'earned' | 'spent';

/**
 * Admin Ledger page — full transaction history for a single Trackee, with
 * `Adjust balance` and `Admin cash-out` inline. Backed by the same
 * `/transactions/trackee/:id/history` endpoint the tablet uses; admins can
 * narrow by `from`/`to` date and by kind bucket.
 */
export function AdminLedgerPage() {
  const { session } = useAuth();
  const tz = useHouseholdTimeZone();
  const adminToken = session.kind === 'admin' ? session.token : null;
  const { on } = useSocket(adminToken);
  const navigate = useNavigate();
  const location = useLocation();
  const preselectedId = new URLSearchParams(location.search).get('user');

  const [trackees, setTrackees] = useState<TrackeeView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(preselectedId);
  const [balance, setBalance] = useState<number | null>(null);
  const [rate, setRate] = useState<number>(0.1);
  const [pendingCashOut, setPendingCashOut] = useState<boolean>(false);
  const [filter, setFilter] = useState<FilterKind>('all');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [history, setHistory] = useState<TransactionView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [cashOutOpen, setCashOutOpen] = useState(false);
  const [actionAmount, setActionAmount] = useState('');
  const [actionReason, setActionReason] = useState('');

  const refreshTrackees = useCallback(async () => {
    if (!adminToken) return;
    try {
      const { trackees: next } = await usersApi.list(adminToken);
      const active = next.filter((t) => t.deactivated_at === null);
      setTrackees(active);
      setActiveId((cur) => cur ?? active[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load Trackees');
    }
  }, [adminToken]);

  useEffect(() => {
    void refreshTrackees();
  }, [refreshTrackees]);

  const refresh = useCallback(async () => {
    if (!adminToken || !activeId) return;
    try {
      const [b, h] = await Promise.all([
        transactionsApi.balance(adminToken, activeId),
        transactionsApi.history(adminToken, activeId, filter, {
          // Date inputs are household-local civil days; bracket them to the
          // household day's UTC instants.
          from: from ? utcInstantInTz(`${from}T00:00:00`, tz).toISOString() : undefined,
          to: to ? utcInstantInTz(`${to}T23:59:59`, tz).toISOString() : undefined,
          limit: 200,
        }),
      ]);
      setBalance(b.balance);
      setRate(b.cash_out_rate);
      setPendingCashOut(b.pending_cash_out);
      setHistory(h.transactions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load ledger');
    }
  }, [adminToken, activeId, filter, from, to, tz]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const off = on('transactions:changed', () => void refresh());
    return off;
  }, [on, refresh]);

  const userDisplayBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of trackees) m.set(t.id, t.display_name);
    return m;
  }, [trackees]);

  const active = trackees.find((t) => t.id === activeId) ?? null;

  const submitAdjust = async () => {
    if (!adminToken || !activeId) return;
    const amount = Number(actionAmount);
    if (!Number.isInteger(amount) || amount === 0) {
      setError('amount must be a non-zero integer');
      return;
    }
    setBusy(true);
    try {
      await transactionsApi.adjustBalance(
        adminToken,
        activeId,
        amount,
        actionReason.trim() || null,
      );
      setAdjustOpen(false);
      setActionAmount('');
      setActionReason('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'adjust failed');
    } finally {
      setBusy(false);
    }
  };

  const submitCashOut = async () => {
    if (!adminToken || !activeId) return;
    const amount = Number(actionAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      setError('amount must be a positive integer');
      return;
    }
    if (balance !== null && amount > balance) {
      setError(`amount exceeds current balance ${balance}`);
      return;
    }
    setBusy(true);
    try {
      await transactionsApi.adminCashOut(adminToken, activeId, amount);
      setCashOutOpen(false);
      setActionAmount('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'cash-out failed');
    } finally {
      setBusy(false);
    }
  };

  if (session.kind !== 'admin') return null;

  return (
    <AdminShell
      active="ledger"
      title="Ledger"
      subtitle={
        active
          ? `${active.display_name} · all kinds, append-only`
          : 'Pick a Trackee to view their transactions'
      }
      actions={
        active && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="logout-button"
              onClick={() => {
                setActionAmount('');
                setActionReason('');
                setError(null);
                setAdjustOpen(true);
                setCashOutOpen(false);
              }}
            >
              Adjust balance
            </button>
            <button
              type="button"
              className="logout-button"
              onClick={() => {
                setActionAmount(String(Math.max(0, balance ?? 0)));
                setError(null);
                setCashOutOpen(true);
                setAdjustOpen(false);
              }}
              disabled={balance === null || balance <= 0}
            >
              Admin cash-out
            </button>
          </div>
        )
      }
    >
      {error && <p className="auth-error">{error}</p>}

      <div className="admin-ledger">
        <div className="admin-ledger-pickerbar">
          {trackees.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`admin-ledger-trackeebtn ${activeId === t.id ? 'is-on' : ''}`}
              onClick={() => {
                setActiveId(t.id);
                navigate(`/admin/ledger?user=${t.id}`, { replace: true });
              }}
            >
              {t.display_name}
            </button>
          ))}
        </div>

        {active && (
          <div className="admin-ledger-summary">
            <div>
              <span style={{ opacity: 0.65, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', fontFamily: 'var(--tb-font-mono)' }}>
                Balance
              </span>
              <div className="admin-ledger-balance">{balance ?? '…'}</div>
            </div>
            {balance !== null && (
              <span style={{ color: 'rgba(255,255,255,0.7)', fontFamily: 'var(--tb-font-mono)', fontSize: 13 }}>
                ≈ ${(balance * rate).toFixed(2)} at 1 PT = ${rate.toFixed(2)}
              </span>
            )}
            {pendingCashOut && (
              <span className="admin-ledger-pending">
                ⚠ pending cash-out request
              </span>
            )}
          </div>
        )}

        <div className="admin-ledger-filters">
          {(['all', 'earned', 'spent'] as FilterKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`tb-chip ${filter === k ? 'is-on' : ''}`}
              onClick={() => setFilter(k)}
            >
              {k.toUpperCase()}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: 'var(--tb-font-mono)',
              fontSize: 11,
              color: 'rgba(255,255,255,0.6)',
            }}
          >
            FROM
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: 'var(--tb-font-mono)',
              fontSize: 11,
              color: 'rgba(255,255,255,0.6)',
            }}
          >
            TO
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>

        <TransactionList
          transactions={history}
          userDisplayBy={userDisplayBy}
          emptyMessage={
            active
              ? 'No transactions in this range.'
              : 'Pick a Trackee above to view their ledger.'
          }
        />
      </div>

      {adjustOpen && active && (
        <div
          className="tb-dialog-backdrop"
          onClick={() => setAdjustOpen(false)}
        >
          <div
            className="tb-dialog"
            style={{ width: 460 }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="tb-dialog-header">
              <div className="tb-dialog-eyebrow">Adjust balance</div>
              <div className="tb-dialog-title">{active.display_name}</div>
            </header>
            <div className="tb-dialog-body">
              {error && (
                <p className="tb-error" style={{ marginBottom: 10 }}>
                  {error}
                </p>
              )}
              <label className="auth-form" style={{ display: 'block' }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
                  Signed amount (positive = reward, negative = penalty)
                </span>
                <input
                  type="number"
                  value={actionAmount}
                  onChange={(e) => setActionAmount(e.target.value)}
                  disabled={busy}
                  style={{ width: '100%', marginTop: 6 }}
                />
              </label>
              <label style={{ display: 'block', marginTop: 12 }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
                  Reason (optional)
                </span>
                <textarea
                  rows={2}
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  disabled={busy}
                  style={{ width: '100%', marginTop: 6 }}
                />
              </label>
            </div>
            <footer className="tb-dialog-footer">
              <button
                type="button"
                className="tb-dialog-btn"
                onClick={() => setAdjustOpen(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="tb-dialog-btn is-primary"
                onClick={submitAdjust}
                disabled={busy}
              >
                {busy ? 'Saving…' : 'Apply'}
              </button>
            </footer>
          </div>
        </div>
      )}

      {cashOutOpen && active && (
        <div
          className="tb-dialog-backdrop"
          onClick={() => setCashOutOpen(false)}
        >
          <div
            className="tb-dialog"
            style={{ width: 460 }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="tb-dialog-header">
              <div className="tb-dialog-eyebrow">Admin cash-out · commit</div>
              <div className="tb-dialog-title">
                Pay {active.display_name}
              </div>
            </header>
            <div className="tb-dialog-body">
              {error && (
                <p className="tb-error" style={{ marginBottom: 10 }}>
                  {error}
                </p>
              )}
              <label style={{ display: 'block' }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
                  Amount (points)
                </span>
                <input
                  type="number"
                  value={actionAmount}
                  max={balance ?? undefined}
                  min={1}
                  onChange={(e) => setActionAmount(e.target.value)}
                  disabled={busy}
                  style={{ width: '100%', marginTop: 6 }}
                />
              </label>
              <p
                style={{
                  marginTop: 12,
                  fontFamily: 'var(--tb-font-mono)',
                  fontSize: 12,
                  color: 'rgba(255,255,255,0.7)',
                }}
              >
                ≈ $
                {(Number(actionAmount) * rate || 0).toFixed(2)} · remaining
                balance{' '}
                {balance !== null ? balance - (Number(actionAmount) || 0) : '—'}
              </p>
            </div>
            <footer className="tb-dialog-footer">
              <button
                type="button"
                className="tb-dialog-btn"
                onClick={() => setCashOutOpen(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="tb-dialog-btn is-primary"
                onClick={submitCashOut}
                disabled={busy}
              >
                {busy ? 'Saving…' : 'Commit cash-out'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
