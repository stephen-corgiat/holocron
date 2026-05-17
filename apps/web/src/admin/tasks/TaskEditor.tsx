import { useState } from 'react';
import {
  CreateRecurringTaskPayload,
  CreateReminderTaskPayload,
  CreateWindowedTaskPayload,
  Ladder,
  TaskKind,
  TaskView,
  TrackeeView,
  UpdateRecurringTaskPayload,
  UpdateReminderTaskPayload,
  UpdateWindowedTaskPayload,
  tasksApi,
} from '../../auth/api';
import { IconPicker } from '../IconPicker';
import { Segmented } from '../Segmented';
import { CheckRow } from '../CheckRow';
import { useHouseholdTimeZone } from '../../settings/SettingsProvider';
import { nowDatetimeLocalInTz, utcInstantInTz } from '../../lib/datetime';
import {
  RecurrenceFields,
  patternFrom,
  recurrenceFieldsFrom,
} from './recurrence-form';
import { RecurrencePicker } from './RecurrencePicker';
import { LadderEditor } from './LadderEditor';

type WindowedMode = 'recurring' | 'one_shot';

interface EditorState {
  name: string;
  icon: string;
  kind: TaskKind;
  due_time: string;
  recurrence: RecurrenceFields;
  active: boolean;
  requires_verification: boolean;
  assignee_ids: Set<string>;
  points: number;
  ladder: Ladder;
  ladder_reset_threshold: number;
  allow_late_completion: boolean;
  late_window_minutes: number;
  windowed_mode: WindowedMode;
  window_start_offset_minutes: number;
  window_end_offset_minutes: number;
  window_start: string; // datetime-local
  window_end: string; // datetime-local
}

function stateFrom(task: TaskView | null, tz: string): EditorState {
  const base: EditorState = {
    name: task?.name ?? '',
    icon: task?.icon ?? '',
    kind: task?.kind ?? 'recurring',
    due_time: task?.due_time ?? '08:00',
    recurrence: recurrenceFieldsFrom(task?.recurrence ?? null, tz),
    active: task?.active ?? true,
    requires_verification: task?.requires_verification ?? false,
    assignee_ids: new Set(task?.assignee_ids ?? []),
    points: task?.points ?? 5,
    ladder:
      task && task.ladder.length > 0
        ? task.ladder.map((t) => ({ ...t }))
        : [{ points: 1, restriction: null }],
    ladder_reset_threshold: task?.ladder_reset_threshold ?? 3,
    allow_late_completion: task?.allow_late_completion ?? true,
    late_window_minutes: task?.late_window_minutes ?? 720,
    windowed_mode: task && task.kind === 'windowed' && !task.recurrence ? 'one_shot' : 'recurring',
    window_start_offset_minutes: task?.window_start_offset_minutes ?? 9 * 60,
    window_end_offset_minutes: task?.window_end_offset_minutes ?? 21 * 60,
    window_start: nowDatetimeLocalInTz(tz, 9),
    window_end: nowDatetimeLocalInTz(tz, 21),
  };
  // Windowed default cadence is weekly-on-Saturday ("do laundry each weekend").
  if (task?.kind === 'windowed' && !task.recurrence) {
    base.points = task.points;
  }
  return base;
}

interface Props {
  mode: 'create' | 'edit';
  // Source task: the row being edited, or the seed for a duplicate. Null = new.
  task: TaskView | null;
  trackees: TrackeeView[];
  adminToken: string;
  onSaved: () => void;
  onCancel: () => void;
  onDeleted: () => void;
}

export function TaskEditor({
  mode,
  task,
  trackees,
  adminToken,
  onSaved,
  onCancel,
  onDeleted,
}: Props) {
  const tz = useHouseholdTimeZone();
  const [form, setForm] = useState<EditorState>(() => stateFrom(task, tz));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = mode === 'edit';
  const kind = form.kind;
  const set = (patch: Partial<EditorState>) => setForm((p) => ({ ...p, ...patch }));

  const toggleAssignee = (id: string) => {
    setForm((p) => {
      const next = new Set(p.assignee_ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...p, assignee_ids: next };
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.assignee_ids.size === 0) {
      setError('assign at least one Trackee');
      return;
    }
    setBusy(true);
    setError(null);
    const icon = form.icon.trim() ? form.icon.trim() : null;
    const assignee_ids = Array.from(form.assignee_ids);
    const name = form.name.trim();
    try {
      if (kind === 'reminder') {
        const recurrence = patternFrom(form.recurrence);
        if (isEdit && task) {
          const payload: UpdateReminderTaskPayload = {
            name,
            icon,
            due_time: form.due_time,
            recurrence,
            active: form.active,
            assignee_ids,
          };
          await tasksApi.update(adminToken, task.id, payload);
        } else {
          const payload: CreateReminderTaskPayload = {
            name,
            due_time: form.due_time,
            recurrence,
            active: form.active,
            assignee_ids,
          };
          if (icon) payload.icon = icon;
          await tasksApi.create(adminToken, payload);
        }
      } else if (kind === 'recurring') {
        const recurrence = patternFrom(form.recurrence);
        const common = {
          name,
          due_time: form.due_time,
          recurrence,
          points: form.points,
          ladder: form.ladder,
          ladder_reset_threshold: form.ladder_reset_threshold,
          allow_late_completion: form.allow_late_completion,
          late_window_minutes: form.late_window_minutes,
          active: form.active,
          requires_verification: form.requires_verification,
          assignee_ids,
        };
        if (isEdit && task) {
          await tasksApi.updateRecurring(adminToken, task.id, {
            ...common,
            icon,
          } as UpdateRecurringTaskPayload);
        } else {
          const payload: CreateRecurringTaskPayload = { ...common };
          if (icon) payload.icon = icon;
          await tasksApi.createRecurring(adminToken, payload);
        }
      } else {
        // windowed
        if (isEdit && task) {
          const payload: UpdateWindowedTaskPayload = {
            name,
            icon,
            points: form.points,
            ladder: form.ladder,
            ladder_reset_threshold: form.ladder_reset_threshold,
            active: form.active,
            requires_verification: form.requires_verification,
            assignee_ids,
          };
          // One-shot windows live on the occurrence and aren't re-editable;
          // only recurring windowed tasks re-send cadence + offsets.
          if (form.windowed_mode === 'recurring') {
            payload.recurrence = patternFrom(form.recurrence);
            payload.window_start_offset_minutes = form.window_start_offset_minutes;
            payload.window_end_offset_minutes = form.window_end_offset_minutes;
          }
          await tasksApi.updateWindowed(adminToken, task.id, payload);
        } else {
          const payload: CreateWindowedTaskPayload = {
            name,
            points: form.points,
            ladder: form.ladder,
            ladder_reset_threshold: form.ladder_reset_threshold,
            active: form.active,
            requires_verification: form.requires_verification,
            assignee_ids,
          };
          if (icon) payload.icon = icon;
          if (form.windowed_mode === 'recurring') {
            payload.recurrence = patternFrom(form.recurrence);
            payload.window_start_offset_minutes = form.window_start_offset_minutes;
            payload.window_end_offset_minutes = form.window_end_offset_minutes;
          } else {
            payload.recurrence = null;
            // The datetime-local inputs are household-local wall clock; convert
            // to the UTC instant they denote in the household zone (ADR-0007).
            payload.window_start = utcInstantInTz(form.window_start, tz).toISOString();
            payload.window_end = utcInstantInTz(form.window_end, tz).toISOString();
          }
          await tasksApi.createWindowed(adminToken, payload);
        }
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!task) return;
    if (
      !confirm(
        `Delete "${task.name}"? This removes the task and all of its occurrences.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await tasksApi.remove(adminToken, task.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed');
    } finally {
      setBusy(false);
    }
  };

  const KINDS: Array<{ id: TaskKind; label: string }> = [
    { id: 'recurring', label: 'Recurring' },
    { id: 'windowed', label: 'Windowed' },
    { id: 'reminder', label: 'Reminder' },
  ];

  const scheduledKind = kind === 'reminder' || kind === 'recurring';

  return (
    <form className="auth-form trackee-form task-editor" onSubmit={submit}>
      <div className="task-editor-head">
        <h2>{isEdit ? form.name || 'Edit task' : 'New task'}</h2>
      </div>

      {error && <p className="auth-error">{error}</p>}

      {/* Basics */}
      <label>
        <span>Task name</span>
        <input
          required
          value={form.name}
          placeholder="Make bed"
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>

      <div className="assignee-chips">
        <span className="assignee-chips-label">Kind</span>
        {/* Kind is fixed once created — the backend validates per kind and has
            no kind-change path. */}
        <Segmented
          options={KINDS.map((k) => ({ value: k.id, label: k.label }))}
          value={kind}
          onChange={(v) => set({ kind: v as TaskKind })}
          disabled={isEdit}
          title={isEdit ? 'Kind cannot be changed after creation' : undefined}
        />
      </div>

      <label>
        <span>Icon</span>
        <IconPicker value={form.icon} onChange={(v) => set({ icon: v })} />
      </label>

      {/* When · recurrence */}
      {scheduledKind && (
        <>
          <RecurrencePicker
            fields={form.recurrence}
            onChange={(recurrence) => set({ recurrence })}
          />
          <label>
            <span>Due time (HH:MM)</span>
            <input
              type="time"
              required
              value={form.due_time}
              onChange={(e) => set({ due_time: e.target.value })}
            />
          </label>
        </>
      )}

      {kind === 'windowed' && (
        <>
          {!isEdit && (
            <div className="assignee-chips">
              <span className="assignee-chips-label">Scheduling</span>
              <Segmented
                options={[
                  { value: 'recurring', label: 'Recurring' },
                  { value: 'one_shot', label: 'One-shot' },
                ]}
                value={form.windowed_mode}
                onChange={(v) => set({ windowed_mode: v as WindowedMode })}
              />
            </div>
          )}
          {form.windowed_mode === 'recurring' ? (
            <>
              <RecurrencePicker
                fields={form.recurrence}
                onChange={(recurrence) => set({ recurrence })}
                presetLabel="Cadence"
                allowedPresets={[
                  'daily',
                  'weekdays',
                  'weekends',
                  'weekly',
                  'biweekly',
                ]}
              />
              <label>
                <span>Window start (minutes after midnight on cadence day)</span>
                <input
                  type="number"
                  min={0}
                  max={60 * 24 * 14}
                  step={30}
                  value={form.window_start_offset_minutes}
                  onChange={(e) =>
                    set({ window_start_offset_minutes: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                <span>Window end (minutes after midnight on cadence day)</span>
                <input
                  type="number"
                  min={0}
                  max={60 * 24 * 14}
                  step={30}
                  value={form.window_end_offset_minutes}
                  onChange={(e) =>
                    set({ window_end_offset_minutes: Number(e.target.value) })
                  }
                />
              </label>
            </>
          ) : (
            <>
              {isEdit && (
                <p className="auth-prose" style={{ opacity: 0.6 }}>
                  A one-shot window is fixed at creation and can't be moved here.
                </p>
              )}
              {!isEdit && (
                <>
                  <label>
                    <span>Window start</span>
                    <input
                      type="datetime-local"
                      required
                      value={form.window_start}
                      onChange={(e) => set({ window_start: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>Window end (Miss fires here)</span>
                    <input
                      type="datetime-local"
                      required
                      value={form.window_end}
                      onChange={(e) => set({ window_end: e.target.value })}
                    />
                  </label>
                </>
              )}
            </>
          )}
        </>
      )}

      {/* Reward */}
      {kind !== 'reminder' && (
        <>
          <label>
            <span>Points reward</span>
            <input
              type="number"
              min={0}
              max={1000000}
              value={form.points}
              onChange={(e) => set({ points: Number(e.target.value) })}
            />
          </label>
          {kind === 'recurring' ? (
            <fieldset className="ladder-fieldset">
              <legend>Late completion</legend>
              <CheckRow
                on={form.allow_late_completion}
                label="Allow late completion"
                help={
                  'Turns a Miss into a "do it anyway" undo: the penalty is ' +
                  'refunded, the ladder retracts, and the streak is preserved. ' +
                  'Disable for items where "late" isn\'t meaningful.'
                }
                onChange={(v) => set({ allow_late_completion: v })}
              />
              <label>
                <span>Late window (minutes)</span>
                <input
                  type="number"
                  min={0}
                  max={60 * 24 * 14}
                  step={15}
                  value={form.late_window_minutes}
                  disabled={!form.allow_late_completion}
                  onChange={(e) =>
                    set({ late_window_minutes: Number(e.target.value) })
                  }
                />
              </label>
            </fieldset>
          ) : (
            <p className="auth-prose" style={{ opacity: 0.6 }}>
              <strong>Late completion is unavailable</strong> for windowed tasks
              — the window already provided the flex (GLOSSARY.md §Windowed task).
            </p>
          )}
        </>
      )}

      {/* Penalty escalation */}
      {kind !== 'reminder' && (
        <LadderEditor
          ladder={form.ladder}
          resetThreshold={form.ladder_reset_threshold}
          onLadderChange={(ladder) => set({ ladder })}
          onResetThresholdChange={(n) => set({ ladder_reset_threshold: n })}
        />
      )}

      {/* Verification */}
      {kind !== 'reminder' && (
        <fieldset className="ladder-fieldset">
          <legend>Verification</legend>
          <CheckRow
            on={form.requires_verification}
            label="Requires admin verification"
            help={
              'When on, marking the task done on the tablet posts the points ' +
              'optimistically and enters Pending review. No Miss can fire until ' +
              'an admin rejects (or the household timeout auto-rejects).'
            }
            onChange={(v) => set({ requires_verification: v })}
          />
        </fieldset>
      )}

      <CheckRow
        on={form.active}
        label="Active"
        help="Inactive tasks stop scheduling new occurrences."
        onChange={(v) => set({ active: v })}
      />

      <div className="assignee-chips">
        <span className="assignee-chips-label">Assigned to</span>
        <div className="assignee-chip-row">
          {trackees.length === 0 && (
            <em style={{ opacity: 0.6 }}>no active Trackees</em>
          )}
          {trackees.map((t) => {
            const on = form.assignee_ids.has(t.id);
            return (
              <button
                type="button"
                key={t.id}
                className={`assignee-chip ${on ? 'is-on' : ''}`}
                onClick={() => toggleAssignee(t.id)}
                style={
                  on && t.color
                    ? { borderColor: t.color, boxShadow: `0 0 0 1px ${t.color}` }
                    : undefined
                }
              >
                {t.display_name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="goals-edit-actions">
        {isEdit && (
          <button
            type="button"
            className="logout-button goals-edit-delete"
            onClick={remove}
            disabled={busy}
          >
            Delete
          </button>
        )}
        <span className="goals-edit-actions-spacer" />
        <button
          type="button"
          className="logout-button"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button type="submit" className="auth-submit" disabled={busy}>
          {isEdit ? 'Save' : 'Create'}
        </button>
      </div>
    </form>
  );
}
