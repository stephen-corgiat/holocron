import { Ladder, RestrictionSpec, Tier } from '../../auth/api';
import { RESTRICTION_OPTIONS } from './recurrence-form';

interface Props {
  ladder: Ladder;
  resetThreshold: number;
  onLadderChange: (next: Ladder) => void;
  onResetThresholdChange: (next: number) => void;
}

export function LadderEditor({
  ladder,
  resetThreshold,
  onLadderChange,
  onResetThresholdChange,
}: Props) {
  const updateTier = (idx: number, patch: Partial<Tier>) =>
    onLadderChange(ladder.map((t, i) => (i === idx ? { ...t, ...patch } : t)));

  const setTierRestriction = (idx: number, value: string) => {
    const restriction: RestrictionSpec | null =
      value === 'internet' || value === 'entertainment' || value === 'games'
        ? { type: value }
        : null;
    updateTier(idx, { restriction });
  };

  const addTier = () =>
    onLadderChange([...ladder, { points: ladder.length + 1, restriction: null }]);

  const removeTier = (idx: number) => {
    if (ladder.length <= 1) return;
    onLadderChange(ladder.filter((_, i) => i !== idx));
  };

  const moveTier = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= ladder.length) return;
    const next = [...ladder];
    const [tier] = next.splice(idx, 1);
    next.splice(target, 0, tier);
    onLadderChange(next);
  };

  return (
    <fieldset className="ladder-fieldset">
      <legend>Penalty escalation</legend>
      <p className="ladder-help">
        Each Miss advances the Trackee one Tier. The last Tier is the "and
        beyond" terminal — further Misses repeat its payload. A Clean streak of
        the configured length resets back to Tier 1.
      </p>
      <ol className="ladder-list">
        {ladder.map((tier, idx) => {
          const restrictionValue = tier.restriction?.type ?? 'none';
          return (
            <li key={idx} className="ladder-row">
              <span className="ladder-row-index">Tier {idx + 1}</span>
              <label className="ladder-row-field">
                <span>Points</span>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  value={tier.points}
                  onChange={(e) =>
                    updateTier(idx, { points: Number(e.target.value) })
                  }
                />
              </label>
              <label className="ladder-row-field">
                <span>Restriction</span>
                <select
                  className="admin-select"
                  value={restrictionValue}
                  onChange={(e) => setTierRestriction(idx, e.target.value)}
                >
                  {RESTRICTION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="ladder-row-actions">
                <button
                  type="button"
                  className="logout-button"
                  onClick={() => moveTier(idx, -1)}
                  disabled={idx === 0}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="logout-button"
                  onClick={() => moveTier(idx, 1)}
                  disabled={idx === ladder.length - 1}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="logout-button"
                  onClick={() => removeTier(idx)}
                  disabled={ladder.length <= 1}
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <button type="button" className="logout-button" onClick={addTier}>
        Add tier
      </button>
      <label>
        <span>Clean streak count to reset ladder</span>
        <input
          type="number"
          min={1}
          max={99}
          value={resetThreshold}
          onChange={(e) => onResetThresholdChange(Number(e.target.value))}
        />
      </label>
    </fieldset>
  );
}
