import { DayOfWeek, RecurrencePreset } from '../../auth/api';
import {
  ALL_PRESETS,
  DAY_LABELS,
  ORDINAL_LABELS,
  RecurrenceFields,
  presetUsesAnchor,
  presetUsesDays,
  presetUsesN,
} from './recurrence-form';

interface Props {
  fields: RecurrenceFields;
  onChange: (next: RecurrenceFields) => void;
  /** Restrict the preset menu (windowed tasks only expose simple cadences). */
  allowedPresets?: RecurrencePreset[];
  /** Label on the preset select. Defaults to "Recurrence". */
  presetLabel?: string;
}

export function RecurrencePicker({
  fields,
  onChange,
  allowedPresets,
  presetLabel = 'Recurrence',
}: Props) {
  const set = (patch: Partial<RecurrenceFields>) => onChange({ ...fields, ...patch });

  const toggleDay = (d: DayOfWeek) => {
    const next = new Set(fields.days);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    set({ days: next });
  };

  const presets = allowedPresets
    ? ALL_PRESETS.filter((p) => allowedPresets.includes(p.value))
    : ALL_PRESETS;

  return (
    <>
      <label>
        <span>{presetLabel}</span>
        <select
          className="admin-select"
          value={fields.preset}
          onChange={(e) => set({ preset: e.target.value as RecurrencePreset })}
        >
          {presets.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      {presetUsesN(fields.preset) && (
        <label>
          <span>N</span>
          <input
            type="number"
            min={1}
            max={365}
            value={fields.n}
            onChange={(e) => set({ n: Number(e.target.value) })}
          />
        </label>
      )}

      {presetUsesDays(fields.preset) && (
        <div className="assignee-chips">
          <span className="assignee-chips-label">Days of week</span>
          <div className="assignee-chip-row">
            {(Object.keys(DAY_LABELS) as unknown as string[]).map((k) => {
              const d = Number(k) as DayOfWeek;
              const on = fields.days.has(d);
              return (
                <button
                  type="button"
                  key={k}
                  className={`assignee-chip ${on ? 'is-on' : ''}`}
                  onClick={() => toggleDay(d)}
                >
                  {DAY_LABELS[d]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {fields.preset === 'every_n_months' && (
        <label>
          <span>Day of month</span>
          <input
            type="number"
            min={1}
            max={31}
            value={fields.day_of_month}
            onChange={(e) => set({ day_of_month: Number(e.target.value) })}
          />
        </label>
      )}

      {fields.preset === 'yearly_on_date' && (
        <>
          <label>
            <span>Month (1-12)</span>
            <input
              type="number"
              min={1}
              max={12}
              value={fields.month}
              onChange={(e) => set({ month: Number(e.target.value) })}
            />
          </label>
          <label>
            <span>Day</span>
            <input
              type="number"
              min={1}
              max={31}
              value={fields.day}
              onChange={(e) => set({ day: Number(e.target.value) })}
            />
          </label>
        </>
      )}

      {fields.preset === 'yearly_in_month' && (
        <>
          <label>
            <span>Month (1-12)</span>
            <input
              type="number"
              min={1}
              max={12}
              value={fields.month}
              onChange={(e) => set({ month: Number(e.target.value) })}
            />
          </label>
          <label>
            <span>Ordinal</span>
            <select
              className="admin-select"
              value={fields.ordinal}
              onChange={(e) => set({ ordinal: Number(e.target.value) })}
            >
              {ORDINAL_LABELS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Day of week</span>
            <select
              className="admin-select"
              value={fields.day_of_week}
              onChange={(e) =>
                set({ day_of_week: Number(e.target.value) as DayOfWeek })
              }
            >
              {(Object.keys(DAY_LABELS) as unknown as string[]).map((k) => (
                <option key={k} value={k}>
                  {DAY_LABELS[Number(k) as DayOfWeek]}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {presetUsesAnchor(fields.preset) && (
        <label>
          <span>Anchor date (week-1 anchor / start date)</span>
          <input
            type="date"
            value={fields.anchor}
            onChange={(e) => set({ anchor: e.target.value })}
          />
        </label>
      )}
    </>
  );
}
