import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminShell } from '../admin/AdminShell';
import { useAuth } from '../auth/AuthProvider';
import {
  OneOffWindow,
  PresenceGridCell,
  PresenceGridCells,
  PresenceRuleKind,
  PresenceScheduleView,
  PresenceUpdate,
  presenceApi,
} from '../auth/api';
import { parseVacationsBlock, VacationEntry, ParseError } from '../presence/vacation-parser';
import { useHouseholdTimeZone } from '../settings/SettingsProvider';
import { todayIsoInTz } from '../lib/datetime';

const KIND_OPTIONS: Array<{
  value: PresenceRuleKind;
  label: string;
}> = [
  { value: 'none', label: 'No schedule' },
  { value: 'full_time', label: 'Full-time (always home)' },
  { value: 'n_week_grid', label: 'N-week grid' },
];

const KIND_LABELS: Record<PresenceRuleKind, string> = {
  none: 'No schedule',
  full_time: 'Full-time',
  n_week_grid: 'N-week grid',
};

const ISO_WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function emptyGrid(n: number): PresenceGridCells {
  return Array.from({ length: n }, () =>
    Array.from({ length: 7 }, () => ({ kind: 'home' }) as PresenceGridCell),
  );
}

function reshapeGrid(
  prev: PresenceGridCells | null,
  n: number,
): PresenceGridCells {
  const base = emptyGrid(n);
  if (!prev) return base;
  for (let w = 0; w < n; w++) {
    const src = prev[w];
    if (!src) continue;
    for (let d = 0; d < 7; d++) {
      if (src[d]) base[w][d] = { ...src[d] };
    }
  }
  return base;
}

export function AdminPresencePage() {
  const { session } = useAuth();
  const tz = useHouseholdTimeZone();
  const adminToken = session.kind === 'admin' ? session.token : null;
  const [schedules, setSchedules] = useState<PresenceScheduleView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);
  const [bulkAddOpen, setBulkAddOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!adminToken) return;
    try {
      const { schedules: rows } = await presenceApi.list(adminToken);
      setSchedules(rows);
      setError(null);
      setActiveId((prev) => prev ?? rows[0]?.user_id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load presence');
    }
  }, [adminToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = useMemo(
    () => schedules.find((s) => s.user_id === activeId) ?? null,
    [schedules, activeId],
  );

  const submit = async (body: PresenceUpdate) => {
    if (!adminToken || !active) return;
    setBusy(true);
    try {
      await presenceApi.update(adminToken, active.user_id, body);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to update');
    } finally {
      setBusy(false);
    }
  };

  const setKind = (kind: PresenceRuleKind) => {
    if (!active) return;
    if (kind !== 'n_week_grid') {
      void submit({ recurring_rule_kind: kind });
      return;
    }
    // Switch to grid: either preserve existing grid shape or start with a 2-week all-home default.
    void submit({
      recurring_rule_kind: 'n_week_grid',
      grid_n_weeks: active.grid_n_weeks ?? 2,
      epoch_date: active.epoch_date ?? isoMondayOf(todayIsoInTz(tz)),
      grid_cells: reshapeGrid(active.grid_cells, active.grid_n_weeks ?? 2),
    });
  };

  return (
    <AdminShell
      active="presence"
      title="Presence"
      subtitle="Per-Trackee residency rules · N-week grid + per-day hand-off"
    >
      {error && <p className="auth-error">{error}</p>}
      <div className="presence-shell">
        <ul className="presence-strip">
          {schedules.map((s) => (
            <li key={s.user_id}>
              <button
                type="button"
                className={`presence-strip-row ${s.user_id === activeId ? 'is-active' : ''}`}
                onClick={() => setActiveId(s.user_id)}
              >
                <div className="presence-strip-meta">
                  <span className="presence-strip-name">{s.display_name}</span>
                  <span className="presence-strip-role">
                    {s.is_admin ? 'admin' : s.is_restrictable ? 'kid' : 'tracked'}
                  </span>
                </div>
                <MiniCalendarGrid schedule={s} />
                <span className="presence-strip-kind">
                  {KIND_LABELS[s.recurring_rule_kind]}
                </span>
              </button>
            </li>
          ))}
          {schedules.length === 0 && !error && (
            <li className="presence-strip-empty">No Trackees yet.</li>
          )}
        </ul>

        <aside className="presence-editor">
          {active ? (
            <>
              <h2 className="presence-editor-title">
                {active.display_name}'s residency rule
              </h2>
              <p className="auth-prose">
                Pick the recurring rule shape. "No schedule" is the parents'
                default; "Full-time" is the kids' default (always home).
                "N-week grid" is the part-time/alternating pattern anchored by
                an epoch date.
              </p>
              <div className="presence-kind-options">
                {KIND_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`presence-kind-option ${
                      active.recurring_rule_kind === opt.value ? 'is-on' : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="presence-kind"
                      value={opt.value}
                      checked={active.recurring_rule_kind === opt.value}
                      disabled={busy}
                      onChange={() => setKind(opt.value)}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
              {active.recurring_rule_kind === 'n_week_grid' && (
                <div className="presence-grid-cta">
                  <p className="presence-grid-summary">
                    {active.grid_n_weeks}-week grid · epoch {active.epoch_date}
                  </p>
                  <button
                    type="button"
                    className="auth-submit"
                    onClick={() => setGridOpen(true)}
                    disabled={busy}
                  >
                    Edit grid…
                  </button>
                </div>
              )}
              <div className="presence-vacations-section">
                <div className="presence-vacations-header">
                  <h3 className="presence-vacations-title">Upcoming vacations</h3>
                  <button
                    type="button"
                    className="presence-vacation-add-btn"
                    onClick={() => setBulkAddOpen(true)}
                    disabled={busy}
                  >
                    Bulk add…
                  </button>
                </div>
                <UpcomingVacationsCard windows={active.one_off_windows ?? []} />
              </div>
            </>
          ) : (
            <p className="auth-prose">Select a Trackee to view their schedule.</p>
          )}
        </aside>
      </div>

      {gridOpen && active && active.recurring_rule_kind === 'n_week_grid' && (
        <GridEditorModal
          key={active.user_id}
          schedule={active}
          busy={busy}
          onSave={async (body) => {
            await submit(body);
            setGridOpen(false);
          }}
          onClose={() => setGridOpen(false)}
        />
      )}

      {bulkAddOpen && active && adminToken && (
        <VacationBulkAddModal
          key={active.user_id}
          schedule={active}
          adminToken={adminToken}
          onCommit={async (windows) => {
            setBusy(true);
            try {
              await presenceApi.addVacations(adminToken, active.user_id, windows);
              await refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'failed to save vacations');
            } finally {
              setBusy(false);
            }
            setBulkAddOpen(false);
          }}
          onClose={() => setBulkAddOpen(false)}
        />
      )}
    </AdminShell>
  );
}

function GridEditorModal({
  schedule,
  busy,
  onSave,
  onClose,
}: {
  schedule: PresenceScheduleView;
  busy: boolean;
  onSave: (body: PresenceUpdate) => void;
  onClose: () => void;
}) {
  const tz = useHouseholdTimeZone();
  const initialN = schedule.grid_n_weeks ?? 2;
  const [n, setN] = useState<number>(initialN);
  const [epoch, setEpoch] = useState<string>(
    schedule.epoch_date ?? isoMondayOf(todayIsoInTz(tz)),
  );
  const [cells, setCells] = useState<PresenceGridCells>(() =>
    reshapeGrid(schedule.grid_cells, initialN),
  );
  const [timeErrors, setTimeErrors] = useState<string | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const changeN = (next: number) => {
    setN(next);
    setCells((prev) => reshapeGrid(prev, next));
  };

  const toggle = (w: number, d: number) => {
    setCells((prev) => {
      const next = prev.map((wk) => wk.map((c) => ({ ...c })));
      const cell = next[w][d];
      cell.kind = cell.kind === 'home' ? 'away' : 'home';
      return next;
    });
  };

  const setHandoff = (w: number, d: number, value: string) => {
    setTimeErrors(null);
    setCells((prev) => {
      const next = prev.map((wk) => wk.map((c) => ({ ...c })));
      const cell = next[w][d];
      if (value === '') delete cell.handoff_time;
      else cell.handoff_time = value;
      return next;
    });
  };

  const epochMondaySnapped = isoMondayOf(epoch);
  const epochMismatch = epochMondaySnapped !== epoch;

  const save = () => {
    // Validate any non-empty handoff times before submitting.
    for (let w = 0; w < cells.length; w++) {
      for (let d = 0; d < cells[w].length; d++) {
        const t = cells[w][d].handoff_time;
        if (t && !HHMM_RE.test(t)) {
          setTimeErrors(`WK ${String.fromCharCode(65 + w)} day ${d + 1}: hand-off time must be HH:MM (e.g. 15:30)`);
          return;
        }
      }
    }
    onSave({
      recurring_rule_kind: 'n_week_grid',
      grid_n_weeks: n,
      epoch_date: epoch,
      grid_cells: cells,
    });
  };

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="presence-modal-backdrop"
      ref={backdropRef}
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className="presence-modal" role="dialog" aria-modal="true">
        <div className="presence-modal-header">
          <div>
            <h2 className="presence-modal-title">
              {schedule.display_name} · N-week grid
            </h2>
            <p className="presence-modal-sub">
              Toggle cells H/A · set per-day hand-off times (HH:MM, 24h)
            </p>
          </div>
          <button
            type="button"
            className="presence-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="presence-modal-body">
          <div className="presence-grid-controls">
            <label className="presence-grid-field">
              <span>N weeks</span>
              <input
                type="number"
                min={1}
                max={6}
                value={n}
                disabled={busy}
                onChange={(e) => changeN(clampInt(e.target.value, 1, 6, n))}
              />
            </label>
            <label className="presence-grid-field">
              <span>Epoch date (ISO)</span>
              <input
                type="date"
                value={epoch}
                disabled={busy}
                onChange={(e) => setEpoch(e.target.value)}
              />
            </label>
            {epochMismatch && (
              <p className="presence-grid-hint presence-grid-hint--snap">
                Snaps to Monday {epochMondaySnapped}
              </p>
            )}
          </div>

          <div className="presence-grid-legend">
            <span className="presence-grid-legend-item is-home">H = home</span>
            <span className="presence-grid-legend-item is-away">A = away</span>
            <span className="presence-grid-legend-sep" />
            <span className="presence-grid-hint">
              Time = when the transition starts · blank = continuous with prior cell
            </span>
          </div>

          <div className="presence-grid">
            <span className="presence-grid-corner" />
            {ISO_WEEKDAYS.map((d, i) => (
              <span key={i} className="presence-grid-headcell">
                {d}
              </span>
            ))}
            {cells.map((week, w) => (
              <Fragment key={`wk-${w}`}>
                <span className="presence-grid-weeklabel">
                  WK {String.fromCharCode(65 + w)}
                </span>
                {week.map((cell, d) => (
                  <div
                    key={`${w}-${d}`}
                    className={`presence-grid-cell is-${cell.kind}`}
                  >
                    <button
                      type="button"
                      className="presence-grid-toggle"
                      onClick={() => toggle(w, d)}
                      disabled={busy}
                      title={`${cell.kind} — click to toggle`}
                    >
                      {cell.kind === 'home' ? 'H' : 'A'}
                    </button>
                    <input
                      type="text"
                      className="presence-grid-time"
                      value={cell.handoff_time ?? ''}
                      placeholder="——:——"
                      maxLength={5}
                      disabled={busy}
                      onChange={(e) => setHandoff(w, d, e.target.value)}
                    />
                  </div>
                ))}
              </Fragment>
            ))}
          </div>

          {timeErrors && <p className="auth-error">{timeErrors}</p>}
        </div>

        <div className="presence-modal-footer">
          <button
            type="button"
            className="presence-modal-cancel"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="auth-submit"
            onClick={save}
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Save grid'}
          </button>
        </div>
      </div>
    </div>
  );
}

function UpcomingVacationsCard({ windows }: { windows: OneOffWindow[] }) {
  const today = todayIsoInTz(useHouseholdTimeZone());
  const upcoming = windows
    .filter((w) => w.end >= today)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 10);

  if (upcoming.length === 0) {
    return <p className="presence-vacations-empty">No upcoming vacations.</p>;
  }

  return (
    <ul className="presence-vacations-list">
      {upcoming.map((w, i) => {
        const nights = nightsBetween(w.start, w.end);
        return (
          <li key={i} className="presence-vacation-row">
            <span className="presence-vacation-label">{w.label}</span>
            <span className="presence-vacation-dates">
              {formatISODate(w.start)} → {formatISODate(w.end)}
            </span>
            <span className="presence-vacation-nights">{nights}d</span>
          </li>
        );
      })}
    </ul>
  );
}

function VacationBulkAddModal({
  schedule,
  adminToken: _adminToken,
  onCommit,
  onClose,
}: {
  schedule: PresenceScheduleView;
  adminToken: string;
  onCommit: (windows: OneOffWindow[]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ entries: VacationEntry[]; errors: ParseError[] }>({
    entries: [],
    errors: [],
  });
  const backdropRef = useRef<HTMLDivElement>(null);

  const parse = (raw: string) => {
    setText(raw);
    setResult(parseVacationsBlock(raw));
  };

  // Inline-editable preview row state: mirrors parsed entries.
  const [edits, setEdits] = useState<VacationEntry[]>([]);
  useEffect(() => {
    setEdits(result.entries.map((e) => ({ ...e })));
  }, [result.entries]);

  const setEditField = (
    i: number,
    field: keyof VacationEntry,
    value: string,
  ) => {
    setEdits((prev) => {
      const next = prev.map((e) => ({ ...e }));
      if (next[i]) next[i][field] = value;
      return next;
    });
  };

  const commit = () => {
    const windows: OneOffWindow[] = edits.map((e) => ({
      start: e.start,
      end: e.end,
      label: e.label,
    }));
    if (windows.length > 0) onCommit(windows);
    else onClose();
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const okCount = result.entries.length;
  const errCount = result.errors.length;

  return (
    <div
      className="presence-modal-backdrop"
      ref={backdropRef}
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className="presence-modal presence-modal--wide" role="dialog" aria-modal="true">
        <div className="presence-modal-header">
          <div>
            <h2 className="presence-modal-title">
              {schedule.display_name} · Bulk add vacations
            </h2>
            <p className="presence-modal-sub">
              Paste lines of the form <code>M/D/YY - M/D/YY: Label</code> · review · confirm
            </p>
          </div>
          <button
            type="button"
            className="presence-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="presence-modal-body presence-vacation-modal-body">
          <div className="presence-vacation-paste-col">
            <p className="presence-vacation-col-label">Paste · multi-line block</p>
            <textarea
              className="presence-vacation-textarea"
              value={text}
              onChange={(e) => parse(e.target.value)}
              placeholder={'5/18/26 - 5/22/26: Summer camp\n6/3/26 - 6/6/26: Work trip · NYC'}
              spellCheck={false}
            />
            <p className="presence-vacation-format-hint">
              FORMAT · <code>M/D/YY - M/D/YY: Label</code> · one per line · 2-digit years assume 20YY
            </p>
          </div>

          <div className="presence-vacation-preview-col">
            <p className="presence-vacation-col-label">
              Preview · {okCount} OK{errCount > 0 ? ` · ${errCount} error${errCount > 1 ? 's' : ''}` : ''}{' '}
              <span className="presence-vacation-preview-hint">inline-editable</span>
            </p>

            {text.trim() === '' ? (
              <p className="presence-vacations-empty">Paste some lines to see a preview.</p>
            ) : (
              <div className="presence-vacation-preview-list">
                {result.errors.map((err) => (
                  <div key={err.line} className="presence-vacation-preview-row is-error">
                    <span className="presence-vacation-preview-icon">✕</span>
                    <div className="presence-vacation-preview-main">
                      <span className="presence-vacation-preview-errtext">{err.text}</span>
                      <span className="presence-vacation-preview-errmsg">{err.message}</span>
                    </div>
                  </div>
                ))}
                {edits.map((entry, i) => (
                  <div key={i} className="presence-vacation-preview-row is-ok">
                    <span className="presence-vacation-preview-icon">✓</span>
                    <input
                      className="presence-vacation-preview-field"
                      value={entry.label}
                      onChange={(e) => setEditField(i, 'label', e.target.value)}
                      aria-label="label"
                    />
                    <input
                      className="presence-vacation-preview-field presence-vacation-preview-date"
                      value={entry.start}
                      onChange={(e) => setEditField(i, 'start', e.target.value)}
                      aria-label="start date"
                    />
                    <input
                      className="presence-vacation-preview-field presence-vacation-preview-date"
                      value={entry.end}
                      onChange={(e) => setEditField(i, 'end', e.target.value)}
                      aria-label="end date"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="presence-modal-footer">
          <button
            type="button"
            className="presence-modal-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="auth-submit"
            onClick={commit}
            disabled={edits.length === 0}
          >
            Commit {edits.length > 0 ? `${edits.length} vacation${edits.length > 1 ? 's' : ''}` : '(no valid entries)'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatISODate(iso: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m, d] = iso.split('-').map(Number);
  return `${months[(m ?? 1) - 1]} ${d} ${y}`;
}

function nightsBetween(start: string, end: string): number {
  const s = new Date(start + 'T00:00:00Z');
  const e = new Date(end + 'T00:00:00Z');
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1);
}

function clampInt(raw: string, min: number, max: number, fallback: number) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function isoMondayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  const jsDow = date.getUTCDay();
  const isoIdx = jsDow === 0 ? 6 : jsDow - 1;
  const mon = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - isoIdx),
  );
  const yy = mon.getUTCFullYear();
  const mm = String(mon.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(mon.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function MiniCalendarGrid({ schedule }: { schedule: PresenceScheduleView }) {
  const kind = schedule.recurring_rule_kind;
  if (kind === 'n_week_grid' && schedule.grid_cells && schedule.grid_n_weeks) {
    const cells = schedule.grid_cells.flat();
    return (
      <div className="presence-mini-grid" aria-label="presence preview">
        {cells.map((c, i) => (
          <span
            key={i}
            className={`presence-mini-cell ${c.kind === 'home' ? 'is-home' : 'is-blank'}`}
          >
            {c.kind === 'home' ? 'H' : 'A'}
          </span>
        ))}
      </div>
    );
  }
  const total = 14;
  const symbol = kind === 'full_time' ? 'H' : '';
  return (
    <div className="presence-mini-grid" aria-label="presence preview">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`presence-mini-cell ${kind === 'full_time' ? 'is-home' : 'is-blank'}`}
        >
          {symbol}
        </span>
      ))}
    </div>
  );
}
