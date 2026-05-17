import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminShell } from '../admin/AdminShell';
import { useAuth } from '../auth/AuthProvider';
import { useSocket } from '../hooks/useSocket';
import { TaskView, TrackeeView, tasksApi, usersApi } from '../auth/api';
import { Glyph } from '../tablet/icons/Glyph';
import { TaskEditor } from '../admin/tasks/TaskEditor';
import { recurrenceSummary } from '../admin/tasks/recurrence-form';
import { clockLabel } from '../lib/datetime';

type Selection =
  | { mode: 'create'; seed: TaskView | null }
  | { mode: 'edit'; task: TaskView };

function scheduleSummary(t: TaskView): string {
  if (t.kind === 'reminder' || t.kind === 'recurring') {
    return `${clockLabel(t.due_time)} · ${recurrenceSummary(t.recurrence)}`;
  }
  // windowed
  if (t.recurrence) {
    return `${recurrenceSummary(t.recurrence)} · window ${
      t.window_start_offset_minutes ?? '?'
    }–${t.window_end_offset_minutes ?? '?'}m`;
  }
  return 'one-shot window';
}

export function AdminTasksPage() {
  const { session } = useAuth();
  const adminToken = session.kind === 'admin' ? session.token : null;
  const { on } = useSocket(adminToken);

  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [trackees, setTrackees] = useState<TrackeeView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [filter, setFilter] = useState<string>('all'); // 'all' | trackee id

  const refresh = useCallback(async () => {
    if (!adminToken) return;
    try {
      const [{ tasks: nextTasks }, { trackees: nextTrackees }] = await Promise.all([
        tasksApi.listAll(adminToken),
        usersApi.list(adminToken),
      ]);
      setTasks(nextTasks);
      setTrackees(nextTrackees);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load tasks');
    }
  }, [adminToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const off = on('tasks:changed', () => void refresh());
    return off;
  }, [on, refresh]);

  const activeTrackees = useMemo(
    () => trackees.filter((t) => t.deactivated_at === null),
    [trackees],
  );

  const trackeeName = (id: string) =>
    trackees.find((t) => t.id === id)?.display_name ?? id.slice(0, 8);
  const trackeeColor = (id: string) =>
    trackees.find((t) => t.id === id)?.color ?? null;

  const visible = useMemo(() => {
    const filtered =
      filter === 'all'
        ? tasks
        : tasks.filter((t) => t.assignee_ids.includes(filter));
    return [...filtered].sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [tasks, filter]);

  if (session.kind !== 'admin') return null;

  const selectedId = selection?.mode === 'edit' ? selection.task.id : null;
  const editorKey =
    selection?.mode === 'edit'
      ? `edit-${selection.task.id}`
      : `create-${selection?.seed?.id ?? 'blank'}`;

  return (
    <AdminShell
      active="tasks"
      title="Tasks"
      subtitle="Routine definitions · one editor for every kind"
      actions={
        <div className="admin-tasks-actions">
          {selection?.mode === 'edit' && (
            <button
              type="button"
              className="logout-button"
              onClick={() =>
                setSelection({ mode: 'create', seed: selection.task })
              }
              title="Create a new task pre-populated from this one"
            >
              Duplicate
            </button>
          )}
          <button
            type="button"
            className="auth-submit"
            onClick={() => setSelection({ mode: 'create', seed: null })}
          >
            New task
          </button>
        </div>
      }
    >
      {error && <p className="auth-error">{error}</p>}

      <div className="admin-tasks-layout">
        {/* LEFT — task list */}
        <div className="admin-tasks-list">
          <div className="admin-tasks-filter">
            <button
              type="button"
              className={`assignee-chip ${filter === 'all' ? 'is-on' : ''}`}
              onClick={() => setFilter('all')}
            >
              All
            </button>
            {activeTrackees.map((t) => (
              <button
                type="button"
                key={t.id}
                className={`assignee-chip ${filter === t.id ? 'is-on' : ''}`}
                onClick={() => setFilter(t.id)}
              >
                {t.display_name}
              </button>
            ))}
          </div>

          <ul className="trackee-list">
            {visible.length === 0 && (
              <li className="trackee-row" style={{ opacity: 0.6 }}>
                No tasks yet. Use “New task” to add one.
              </li>
            )}
            {visible.map((t) => (
              <li
                key={t.id}
                className={`trackee-row admin-tasks-row ${
                  t.active ? '' : 'is-deactivated'
                } ${selectedId === t.id ? 'is-selected' : ''}`}
                onClick={() => setSelection({ mode: 'edit', task: t })}
              >
                <div className="trackee-row-main">
                  {t.icon && (
                    <span className="admin-tasks-row-icon">
                      <Glyph name={t.icon} size={16} color="currentColor" />
                    </span>
                  )}
                  <div>
                    <div className="trackee-name">
                      {t.name}
                      {t.kind === 'reminder' && (
                        <span className="badge"> reminder</span>
                      )}
                      {t.kind === 'windowed' && (
                        <span className="badge"> windowed</span>
                      )}
                      {t.requires_verification && (
                        <span className="badge"> verify</span>
                      )}
                      {!t.active && <span className="badge"> inactive</span>}
                    </div>
                    <div className="trackee-meta">{scheduleSummary(t)}</div>
                  </div>
                </div>
                <div className="admin-tasks-row-assignees">
                  {t.assignee_ids.map((id) => {
                    const color = trackeeColor(id);
                    return (
                      <span
                        key={id}
                        className="admin-tasks-assignee-badge"
                        title={trackeeName(id)}
                        style={color ? { background: color } : undefined}
                      >
                        {trackeeName(id).slice(0, 1).toUpperCase()}
                      </span>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* RIGHT — editor */}
        <div className="admin-tasks-editor">
          {selection ? (
            <TaskEditor
              key={editorKey}
              mode={selection.mode}
              task={selection.mode === 'edit' ? selection.task : selection.seed}
              trackees={activeTrackees}
              adminToken={adminToken as string}
              onSaved={() => {
                setSelection(null);
                void refresh();
              }}
              onDeleted={() => {
                setSelection(null);
                void refresh();
              }}
              onCancel={() => setSelection(null)}
            />
          ) : (
            <div className="admin-tasks-empty">
              <p>Select a task to edit, or create a new one.</p>
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
