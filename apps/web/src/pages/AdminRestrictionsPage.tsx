import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useSocket } from '../hooks/useSocket';
import {
  AdminRestrictionView,
  EnforcementLogView,
  RemediationRequestView,
  RestrictionScope,
  RestrictionsOverviewResponse,
  ScopeSummary,
  TrackeeView,
  restrictionsApi,
  usersApi,
} from '../auth/api';
import { AdminShell } from '../admin/AdminShell';
import { useHouseholdTimeZone } from '../settings/SettingsProvider';
import { isoDateInTz, wallClockInTz } from '../lib/datetime';

const SCOPES: RestrictionScope[] = ['internet', 'entertainment', 'games'];
const SCOPE_LABEL: Record<RestrictionScope, string> = {
  internet: 'All internet',
  entertainment: 'Entertainment',
  games: 'Games',
};

const EMPTY_OVERVIEW: RestrictionsOverviewResponse = {
  scopes: SCOPES.map((scope) => ({
    scope,
    blocked_user_ids: [],
    total_restrictable: 0,
  })),
  active: [],
  remediation_requests: [],
  enforcement_log: [],
};

export function AdminRestrictionsPage() {
  const { session } = useAuth();
  const adminToken = session.kind === 'admin' ? session.token : null;
  const { on } = useSocket(adminToken);

  const [overview, setOverview] =
    useState<RestrictionsOverviewResponse>(EMPTY_OVERVIEW);
  const [trackees, setTrackees] = useState<TrackeeView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [blockTarget, setBlockTarget] = useState<RestrictionScope | null>(null);

  const refresh = useCallback(async () => {
    if (!adminToken) return;
    try {
      const [next, { trackees: roster }] = await Promise.all([
        restrictionsApi.overview(adminToken),
        usersApi.list(adminToken),
      ]);
      setOverview(next);
      setTrackees(roster);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load');
    }
  }, [adminToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const off = on('restrictions:changed', () => void refresh());
    return off;
  }, [on, refresh]);

  const restrictableTrackees = useMemo(
    () => trackees.filter((t) => t.is_restrictable && !t.deactivated_at),
    [trackees],
  );

  const lift = async (id: string) => {
    if (!adminToken) return;
    if (!window.confirm('Lift this restriction now?')) return;
    setBusy(id);
    setError(null);
    try {
      await restrictionsApi.lift(adminToken, id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'lift failed');
    } finally {
      setBusy(null);
    }
  };

  const submitBlockNow = async (
    userId: string,
    scope: RestrictionScope,
    reason: string,
  ) => {
    if (!adminToken) return;
    setBusy(`block:${scope}`);
    setError(null);
    try {
      await restrictionsApi.blockNow(adminToken, {
        user_id: userId,
        scope,
        reason: reason || undefined,
      });
      setBlockTarget(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'block failed');
    } finally {
      setBusy(null);
    }
  };

  const resolveRequest = async (id: string) => {
    if (!adminToken) return;
    setBusy(id);
    try {
      await restrictionsApi.resolveRequest(adminToken, id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'resolve failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminShell
      active="restrictions"
      title="Restrictions"
      subtitle="Per-scope enforcement (router + PiHole) · per-Trackee blocks · lift-mechanism orthogonal dimensions (ADR-0004)"
    >
      {error && <p className="auth-error">{error}</p>}

      <section className="admin-section">
        <h2 className="admin-section-title">
          Restriction scopes · blocked / total Trackees
        </h2>
        <div className="restrictions-scope-grid">
          {overview.scopes.map((s) => (
            <ScopeCard
              key={s.scope}
              summary={s}
              onBlockNow={() => setBlockTarget(s.scope)}
            />
          ))}
        </div>
      </section>

      <section className="admin-section">
        <h2 className="admin-section-title">
          Active restrictions · {overview.active.length}
        </h2>
        <p className="admin-section-hint">
          EFFECTIVE EXPIRY = MAX(CAUSES) · REMEDIATION = UNION(CAUSES)
        </p>
        {overview.active.length === 0 ? (
          <p className="auth-prose">No active restrictions.</p>
        ) : (
          <ul className="restrictions-active-list">
            {overview.active.map((r) => (
              <ActiveRow
                key={r.id}
                restriction={r}
                onLift={() => lift(r.id)}
                liftBusy={busy === r.id}
                notEnforced={isNotEnforced(r, overview.enforcement_log)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="admin-section">
        <h2 className="admin-section-title">
          Ask-a-parent requests · {overview.remediation_requests.length}
        </h2>
        {overview.remediation_requests.length === 0 ? (
          <p className="auth-prose">No open requests.</p>
        ) : (
          <ul className="restrictions-request-list">
            {overview.remediation_requests.map((r) => (
              <RequestRow
                key={r.id}
                request={r}
                onResolve={() => resolveRequest(r.id)}
                busy={busy === r.id}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="admin-section">
        <h2 className="admin-section-title">
          Enforcement log · {overview.enforcement_log.length} recent calls
        </h2>
        {overview.enforcement_log.length === 0 ? (
          <p className="auth-prose">No enforcement calls yet.</p>
        ) : (
          <ul className="restrictions-enforcement-list">
            {overview.enforcement_log.map((row) => (
              <EnforcementRow
                key={row.id}
                row={row}
                trackees={trackees}
              />
            ))}
          </ul>
        )}
      </section>

      {blockTarget && (
        <BlockNowDialog
          scope={blockTarget}
          trackees={restrictableTrackees}
          onClose={() => setBlockTarget(null)}
          onSubmit={submitBlockNow}
          busy={busy === `block:${blockTarget}`}
        />
      )}
    </AdminShell>
  );
}

function ScopeCard({
  summary,
  onBlockNow,
}: {
  summary: ScopeSummary;
  onBlockNow: () => void;
}) {
  const blocked = summary.blocked_user_ids.length;
  const isBlocked = blocked > 0;
  return (
    <article
      className={`restrictions-scope-card ${isBlocked ? 'is-blocked' : ''}`}
    >
      <header className="restrictions-scope-head">
        <span className="restrictions-scope-label">
          {SCOPE_LABEL[summary.scope]}
        </span>
      </header>
      <div className="restrictions-scope-count">
        <span className="restrictions-scope-blocked">{blocked}</span>
        <span className="restrictions-scope-total">
          /{summary.total_restrictable}
        </span>
      </div>
      <button
        type="button"
        className="restrictions-block-btn"
        onClick={onBlockNow}
      >
        Block now
      </button>
    </article>
  );
}

function ActiveRow({
  restriction,
  onLift,
  liftBusy,
  notEnforced,
}: {
  restriction: AdminRestrictionView;
  onLift: () => void;
  liftBusy: boolean;
  notEnforced: boolean;
}) {
  const tz = useHouseholdTimeZone();
  const summary = causeSummary(restriction);
  const expiry = restriction.effective_expires_at
    ? formatDateTime(restriction.effective_expires_at, tz)
    : 'parent-only';
  const remediation =
    restriction.effective_remediation_goals.length === 0
      ? 'parent-only'
      : `${restriction.effective_remediation_goals.length} goal${
          restriction.effective_remediation_goals.length === 1 ? '' : 's'
        }`;
  const addressLabel =
    restriction.scope === 'internet' ? 'IP-addressable' : 'MAC-addressable';
  return (
    <li className="restrictions-active-row">
      <div className="restrictions-active-main">
        <div className="restrictions-active-title">
          {restriction.user_display_name}
          <span className="restrictions-active-scope">
            · {SCOPE_LABEL[restriction.scope].toLowerCase()} blocked
          </span>
          <span className="restrictions-cause-count">
            {restriction.causes.length} CAUSE
            {restriction.causes.length === 1 ? '' : 'S'}
          </span>
          {notEnforced && (
            <span
              className="restrictions-not-enforced"
              title={`Last enforcement attempt was skipped — no ${addressLabel} devices enrolled for this Trackee.`}
            >
              NOT ENFORCED
            </span>
          )}
        </div>
        <div className="restrictions-active-summary">{summary}</div>
        <div className="restrictions-active-meta">
          <span>
            EFFECTIVE EXPIRY · <b>{expiry}</b>
          </span>
          <span>
            EFFECTIVE REMEDIATION · <b>{remediation}</b>
          </span>
        </div>
      </div>
      <div className="restrictions-active-actions">
        <button
          type="button"
          className="auth-submit is-ghost"
          onClick={onLift}
          disabled={liftBusy}
        >
          Lift early
        </button>
      </div>
    </li>
  );
}

function RequestRow({
  request,
  onResolve,
  busy,
}: {
  request: RemediationRequestView;
  onResolve: () => void;
  busy: boolean;
}) {
  const tz = useHouseholdTimeZone();
  return (
    <li className="restrictions-request-row">
      <div>
        <strong>{request.user_display_name}</strong> asked about{' '}
        <em>{SCOPE_LABEL[request.scope].toLowerCase()}</em>
        {request.note && <span className="restrictions-request-note"> — {request.note}</span>}
        <div className="restrictions-request-meta">
          {formatDateTime(request.created_at, tz)}
        </div>
      </div>
      <button
        type="button"
        className="auth-submit is-ghost"
        onClick={onResolve}
        disabled={busy}
      >
        Mark resolved
      </button>
    </li>
  );
}

function EnforcementRow({
  row,
  trackees,
}: {
  row: EnforcementLogView;
  trackees: TrackeeView[];
}) {
  const tz = useHouseholdTimeZone();
  const trackee = trackees.find((t) => t.id === row.user_id);
  const name = trackee?.display_name ?? row.user_id.slice(0, 8);
  const isOk = row.result === 'ok';
  return (
    <li
      className={`restrictions-enforcement-row is-${row.result}`}
    >
      <div className="restrictions-enforcement-main">
        <span className="restrictions-enforcement-trackee">{name}</span>
        <span
          className={`restrictions-enforcement-backend is-${row.backend}`}
        >
          {row.backend}
        </span>
        <span className="restrictions-enforcement-scope">
          {SCOPE_LABEL[row.scope].toLowerCase()}
        </span>
        <span className="restrictions-enforcement-action">
          {row.action} {row.target_address ?? '∅'}
        </span>
        <span
          className={`restrictions-enforcement-result is-${row.result}`}
        >
          {isOk
            ? `ok${row.http_status ? ` (${row.http_status})` : ''}`
            : `${row.result}${row.http_status ? ` ${row.http_status}` : ''}`}
        </span>
      </div>
      {row.error && (
        <div className="restrictions-enforcement-error">{row.error}</div>
      )}
      <div className="restrictions-enforcement-meta">
        {formatDateTime(row.created_at, tz)}
      </div>
    </li>
  );
}

function BlockNowDialog({
  scope,
  trackees,
  onClose,
  onSubmit,
  busy,
}: {
  scope: RestrictionScope;
  trackees: TrackeeView[];
  onClose: () => void;
  onSubmit: (userId: string, scope: RestrictionScope, reason: string) => void;
  busy: boolean;
}) {
  const [userId, setUserId] = useState<string>(trackees[0]?.id ?? '');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!userId && trackees[0]) setUserId(trackees[0].id);
  }, [trackees, userId]);

  if (trackees.length === 0) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
          <h3>Block now · {SCOPE_LABEL[scope]}</h3>
          <p className="auth-prose">
            No Restrictable Trackees configured — flip `is_restrictable` on at
            least one user.
          </p>
          <button type="button" className="auth-submit" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h3>Block now · {SCOPE_LABEL[scope]}</h3>
        <p className="auth-prose">
          Records an AdminCause: parent-only on auto-expiry and on
          remediation — only an Admin lift will clear it.
        </p>
        <label className="auth-label">
          Trackee
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="auth-input"
          >
            {trackees.map((t) => (
              <option key={t.id} value={t.id}>
                {t.display_name}
              </option>
            ))}
          </select>
        </label>
        <label className="auth-label">
          Reason (optional)
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="auth-input"
            placeholder="e.g. screen time exceeded"
            maxLength={500}
          />
        </label>
        <div className="modal-actions">
          <button
            type="button"
            className="auth-submit is-ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="auth-submit"
            onClick={() => onSubmit(userId, scope, reason)}
            disabled={busy || !userId}
          >
            Block now
          </button>
        </div>
      </div>
    </div>
  );
}

function causeSummary(r: AdminRestrictionView): string {
  if (r.causes.length === 0) return '(no causes)';
  const parts: string[] = [];
  const missCount = r.causes.filter((c) => c.kind === 'miss').length;
  const adminCount = r.causes.filter((c) => c.kind === 'admin').length;
  if (missCount > 0) {
    const names = r.causes
      .filter((c) => c.kind === 'miss')
      .map((c) => c.occurrence_task_name)
      .filter((n): n is string => !!n);
    parts.push(
      `MissCause × ${missCount}${names.length ? ' — ' + names.join(', ') : ''}`,
    );
  }
  if (adminCount > 0) {
    parts.push(`AdminCause × ${adminCount}`);
  }
  return parts.join(' · ');
}

/**
 * The most recent enforcement_log row for this restriction wins. If the
 * adapter wrote `result='skipped'` (no addressable devices), surface a
 * "NOT ENFORCED" badge so the admin knows the block is recorded but the
 * backend never engaged.
 */
function isNotEnforced(
  restriction: AdminRestrictionView,
  log: EnforcementLogView[],
): boolean {
  for (const row of log) {
    if (row.restriction_id === restriction.id) {
      return row.result === 'skipped';
    }
  }
  return false;
}

function formatDateTime(iso: string, tz: string): string {
  const date = isoDateInTz(iso, tz); // YYYY-MM-DD in the household zone
  return `${date.slice(5, 7)}/${date.slice(8, 10)} ${wallClockInTz(iso, tz)}`;
}
