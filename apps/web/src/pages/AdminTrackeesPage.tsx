import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import {
  CreateTrackeePayload,
  DevicePayload,
  DeviceView,
  TrackeeView,
  UpdateTrackeePayload,
  devicesApi,
  transactionsApi,
  usersApi,
} from '../auth/api';
import { AdminShell } from '../admin/AdminShell';

type FormMode = { kind: 'idle' } | { kind: 'create' } | { kind: 'edit'; id: string };

interface FormState {
  display_name: string;
  is_admin: boolean;
  is_restrictable: boolean;
  router_id: string;
  password: string;
  username: string;
  color: string;
}

function blankForm(): FormState {
  return {
    display_name: '',
    is_admin: false,
    is_restrictable: false,
    router_id: '',
    password: '',
    username: '',
    color: '',
  };
}

function formFromTrackee(t: TrackeeView): FormState {
  return {
    display_name: t.display_name,
    is_admin: t.is_admin,
    is_restrictable: t.is_restrictable,
    router_id: t.router_id ?? '',
    password: '',
    username: t.username ?? '',
    color: t.color ?? '',
  };
}

export function AdminTrackeesPage() {
  const { session } = useAuth();
  const adminToken = session.kind === 'admin' ? session.token : null;

  const [trackees, setTrackees] = useState<TrackeeView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<FormMode>({ kind: 'idle' });
  const [form, setForm] = useState<FormState>(blankForm());

  const refresh = useCallback(async () => {
    if (!adminToken) return;
    try {
      const { trackees: next } = await usersApi.list(adminToken);
      setTrackees(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load Trackees');
    }
  }, [adminToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startCreate = () => {
    setMode({ kind: 'create' });
    setForm(blankForm());
    setError(null);
  };

  const startEdit = (t: TrackeeView) => {
    setMode({ kind: 'edit', id: t.id });
    setForm(formFromTrackee(t));
    setError(null);
  };

  const cancel = () => {
    setMode({ kind: 'idle' });
    setForm(blankForm());
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken || mode.kind === 'idle') return;
    setBusy(true);
    setError(null);
    try {
      if (mode.kind === 'create') {
        const payload: CreateTrackeePayload = {
          display_name: form.display_name.trim(),
          is_admin: form.is_admin,
          is_restrictable: form.is_restrictable,
        };
        // Empty router_id is meaningful — only send the field when the user
        // explicitly typed one. Omitting it lets the backend auto-derive.
        if (form.router_id !== '') payload.router_id = form.router_id.trim();
        if (form.color) payload.color = form.color;
        if (form.is_admin && form.password) payload.password = form.password;
        if (form.username) payload.username = form.username.trim();
        await usersApi.create(adminToken, payload);
      } else {
        const payload: UpdateTrackeePayload = {
          display_name: form.display_name.trim(),
          is_admin: form.is_admin,
          is_restrictable: form.is_restrictable,
          router_id: form.router_id,
          color: form.color || null,
        };
        if (form.password) payload.password = form.password;
        if (form.username) payload.username = form.username.trim();
        await usersApi.update(adminToken, mode.id, payload);
      }
      cancel();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (t: TrackeeView) => {
    if (!adminToken) return;
    if (!confirm(`Deactivate ${t.display_name}? They'll be removed from the tablet's tab strip.`)) {
      return;
    }
    setBusy(true);
    try {
      await usersApi.deactivate(adminToken, t.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'deactivate failed');
    } finally {
      setBusy(false);
    }
  };

  const sorted = useMemo(
    () =>
      [...trackees].sort((a, b) => {
        if (Number(a.deactivated_at !== null) !== Number(b.deactivated_at !== null)) {
          return Number(a.deactivated_at !== null) - Number(b.deactivated_at !== null);
        }
        if (a.is_admin !== b.is_admin) return a.is_admin ? 1 : -1;
        return a.created_at.localeCompare(b.created_at);
      }),
    [trackees],
  );

  if (session.kind !== 'admin') return null;

  const activeCount = trackees.filter((t) => t.deactivated_at === null).length;
  const totalCount = trackees.length;
  const subtitle =
    totalCount === 0
      ? 'No Trackees yet'
      : `${activeCount} active · ${totalCount - activeCount} deactivated`;

  return (
    <AdminShell
      active="users"
      title="Users"
      subtitle={subtitle}
      actions={
        mode.kind === 'idle' ? (
          <button type="button" className="auth-submit" onClick={startCreate}>
            New Trackee
          </button>
        ) : null
      }
    >
      {error && <p className="auth-error">{error}</p>}

      {mode.kind !== 'idle' && (
        <form className="auth-form trackee-form" onSubmit={submit}>
          <label>
            <span>Display name</span>
            <input
              required
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            />
          </label>
          <label>
            <span>router_id (auto-derived if blank on create; empty skips router)</span>
            <input
              value={form.router_id}
              placeholder={
                mode.kind === 'create' && form.display_name
                  ? `default: ${slugPreview(form.display_name)}`
                  : ''
              }
              onChange={(e) => setForm({ ...form, router_id: e.target.value })}
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.is_admin}
              onChange={(e) => setForm({ ...form, is_admin: e.target.checked })}
            />
            <span>is_admin</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.is_restrictable}
              onChange={(e) => setForm({ ...form, is_restrictable: e.target.checked })}
            />
            <span>is_restrictable</span>
          </label>
          {form.is_admin && (
            <>
              <label>
                <span>username (admins log in)</span>
                <input
                  value={form.username}
                  placeholder={
                    form.display_name ? `default: ${slugPreview(form.display_name)}` : ''
                  }
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </label>
              <label>
                <span>
                  password{' '}
                  {mode.kind === 'edit' && (
                    <em style={{ opacity: 0.6 }}>(leave blank to keep current)</em>
                  )}
                </span>
                <input
                  type="password"
                  minLength={8}
                  required={mode.kind === 'create'}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </label>
            </>
          )}
          <label>
            <span>color (hex, optional)</span>
            <input
              value={form.color}
              placeholder="#7adff0"
              onChange={(e) => setForm({ ...form, color: e.target.value })}
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="auth-submit" disabled={busy}>
              {mode.kind === 'create' ? 'Create' : 'Save'}
            </button>
            <button
              type="button"
              className="logout-button"
              onClick={cancel}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
          {mode.kind === 'edit' && adminToken && (
            <DevicesSection userId={mode.id} adminToken={adminToken} />
          )}
        </form>
      )}

      <ul className="trackee-list">
        {sorted.map((t) => (
          <li key={t.id} className={`trackee-row ${t.deactivated_at ? 'is-deactivated' : ''}`}>
            <div className="trackee-row-main">
              <span
                className="trackee-color-chip"
                style={{ background: t.color ?? 'rgba(236,239,241,0.2)' }}
              />
              <div>
                <div className="trackee-name">
                  {t.display_name}
                  {t.deactivated_at && <span className="badge"> deactivated</span>}
                </div>
                <div className="trackee-meta">
                  router_id: <code>{t.router_id ?? '∅'}</code>
                  {t.is_admin && <span className="badge"> is_admin</span>}
                  {t.is_restrictable && <span className="badge"> is_restrictable</span>}
                </div>
                {adminToken && !t.deactivated_at && (
                  <BalanceActions
                    userId={t.id}
                    displayName={t.display_name}
                    adminToken={adminToken}
                  />
                )}
              </div>
            </div>
            <div className="trackee-row-actions">
              <Link
                className="logout-button"
                to={`/admin/users/${t.id}/history`}
                style={{ textDecoration: 'none' }}
              >
                Tasks history
              </Link>
              <Link
                className="logout-button"
                to={`/admin/ledger?user=${t.id}`}
                style={{ textDecoration: 'none' }}
              >
                View ledger →
              </Link>
              <button
                type="button"
                className="logout-button"
                onClick={() => startEdit(t)}
                disabled={busy}
              >
                Edit
              </button>
              {!t.deactivated_at && (
                <button
                  type="button"
                  className="logout-button"
                  onClick={() => deactivate(t)}
                  disabled={busy}
                >
                  Deactivate
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </AdminShell>
  );
}

function DevicesSection({
  userId,
  adminToken,
}: {
  userId: string;
  adminToken: string;
}) {
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const [draft, setDraft] = useState<DevicePayload>({
    display_name: '',
    ip_address: '',
    mac_address: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { devices: next } = await devicesApi.list(adminToken, userId);
      setDevices(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to load devices');
    }
  }, [adminToken, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    setErr(null);
    try {
      await devicesApi.create(adminToken, userId, {
        display_name: draft.display_name.trim(),
        ip_address: draft.ip_address?.trim() || null,
        mac_address: draft.mac_address?.trim() || null,
      });
      setDraft({ display_name: '', ip_address: '', mac_address: '' });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'add failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (deviceId: string) => {
    if (!confirm('Remove this device?')) return;
    setBusy(true);
    try {
      await devicesApi.remove(adminToken, userId, deviceId);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'remove failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="trackee-devices">
      <h4>Devices · {devices.length}</h4>
      {err && <p className="auth-error">{err}</p>}
      {devices.length === 0 ? (
        <p className="auth-prose" style={{ marginBottom: 8 }}>
          No devices enrolled. A Restrictable Trackee with zero devices skips
          router enforcement.
        </p>
      ) : (
        <ul className="trackee-device-list">
          {devices.map((d) => (
            <li key={d.id} className="trackee-device-row">
              <span className="name">{d.display_name}</span>
              <span className="meta">
                ip: <code>{d.ip_address ?? '∅'}</code> · mac:{' '}
                <code>{d.mac_address ?? '∅'}</code>
              </span>
              <button
                type="button"
                className="logout-button"
                onClick={() => remove(d.id)}
                disabled={busy}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="trackee-device-form">
        <input
          placeholder="display_name"
          value={draft.display_name}
          onChange={(e) =>
            setDraft({ ...draft, display_name: e.target.value })
          }
        />
        <input
          placeholder="ip_address"
          value={draft.ip_address ?? ''}
          onChange={(e) => setDraft({ ...draft, ip_address: e.target.value })}
        />
        <input
          placeholder="mac_address"
          value={draft.mac_address ?? ''}
          onChange={(e) =>
            setDraft({ ...draft, mac_address: e.target.value })
          }
        />
        <button
          type="button"
          className="auth-submit"
          onClick={add}
          disabled={busy || !draft.display_name.trim()}
        >
          Add device
        </button>
      </div>
    </div>
  );
}

/**
 * Inline balance + Adjust Balance + Cash Out. Available on every Trackee row.
 * Cash-out is disabled when balance < 0, mirroring the tablet rule.
 */
function BalanceActions({
  userId,
  displayName,
  adminToken,
}: {
  userId: string;
  displayName: string;
  adminToken: string;
}) {
  const [balance, setBalance] = useState<number | null>(null);
  const [rate, setRate] = useState<number>(0.1);
  const [dialog, setDialog] = useState<'idle' | 'adjust' | 'cashout'>('idle');
  const [amountInput, setAmountInput] = useState('');
  const [reasonInput, setReasonInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await transactionsApi.balance(adminToken, userId);
      setBalance(r.balance);
      setRate(r.cash_out_rate);
    } catch {
      // ignore; the cell is best-effort
    }
  }, [adminToken, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openAdjust = () => {
    setAmountInput('');
    setReasonInput('');
    setError(null);
    setDialog('adjust');
  };
  const openCashOut = () => {
    setAmountInput(balance !== null ? String(Math.max(0, balance)) : '');
    setError(null);
    setDialog('cashout');
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const amount = Number(amountInput);
      if (!Number.isFinite(amount)) {
        setError('amount must be a number');
        setBusy(false);
        return;
      }
      if (dialog === 'adjust') {
        if (!Number.isInteger(amount) || amount === 0) {
          setError('amount must be a non-zero integer');
          setBusy(false);
          return;
        }
        await transactionsApi.adjustBalance(
          adminToken,
          userId,
          amount,
          reasonInput.trim() || null,
        );
      } else if (dialog === 'cashout') {
        if (!Number.isInteger(amount) || amount <= 0) {
          setError('amount must be a positive integer');
          setBusy(false);
          return;
        }
        if (balance !== null && amount > balance) {
          setError(`amount exceeds current balance ${balance}`);
          setBusy(false);
          return;
        }
        await transactionsApi.adminCashOut(adminToken, userId, amount);
      }
      setDialog('idle');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  const newBalance =
    balance !== null && amountInput
      ? balance + (dialog === 'adjust' ? Number(amountInput) || 0 : -(Number(amountInput) || 0))
      : balance;

  const cashOutHidden = balance !== null && balance <= 0;

  return (
    <div className="trackee-balance-row">
      <span className="trackee-balance">
        Balance: <strong>{balance ?? '…'}</strong>
        {balance !== null && (
          <span className="trackee-balance-dollars">
            {' '}
            (≈ ${(balance * rate).toFixed(2)})
          </span>
        )}
      </span>
      <button type="button" className="logout-button" onClick={openAdjust} disabled={busy}>
        Adjust
      </button>
      {!cashOutHidden && (
        <button
          type="button"
          className="logout-button"
          onClick={openCashOut}
          disabled={busy}
        >
          Cash out
        </button>
      )}

      {dialog !== 'idle' && (
        <div className="cashout-dialog" role="dialog">
          <h4>
            {dialog === 'adjust' ? 'Adjust balance' : 'Cash out'} · {displayName}
          </h4>
          {error && <p className="auth-error">{error}</p>}
          <label>
            <span>
              {dialog === 'adjust'
                ? 'Signed amount (positive = reward, negative = penalty)'
                : 'Amount (points)'}
            </span>
            <input
              type="number"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              disabled={busy}
            />
          </label>
          {dialog === 'adjust' && (
            <label>
              <span>Reason (optional)</span>
              <textarea
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                disabled={busy}
                rows={2}
              />
            </label>
          )}
          {balance !== null && amountInput && (
            <p className="auth-prose">
              {dialog === 'adjust'
                ? `Adjust ${displayName}'s balance by ${amountInput}. New balance: ${newBalance}.`
                : `Cash out ${amountInput} points (≈ $${(Number(amountInput) * rate).toFixed(2)}). Remaining balance: ${newBalance}.`}
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="auth-submit"
              onClick={submit}
              disabled={busy}
            >
              {busy ? 'Saving…' : 'Confirm'}
            </button>
            <button
              type="button"
              className="logout-button"
              onClick={() => setDialog('idle')}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline preview for the admin form — the canonical implementation lives on
// the backend (apps/api/src/users/slug.ts). This duplicate is purely a
// UX-affordance to show the default before the round trip.
function slugPreview(displayName: string): string {
  return displayName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
