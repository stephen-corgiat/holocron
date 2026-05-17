import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { CatalogGoalView } from '../../auth/api';

interface Props {
  open: boolean;
  onClose: () => void;
  goal: CatalogGoalView | null;
  balance: number;
  rate: number;
  busy?: boolean;
  error?: string | null;
  onConfirm: (tierValue: number) => Promise<void> | void;
}

export function TierPickerDialog({
  open,
  onClose,
  goal,
  balance,
  rate,
  busy,
  error,
  onConfirm,
}: Props) {
  const tierValues = goal?.tier_values ?? [];
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    setPicked(null);
  }, [goal?.id]);

  if (!goal) return null;

  const newBalance = picked !== null ? balance + picked : balance;
  const remaining = Math.max(0, goal.completion_limit - (goal.completion_limit - goal.remaining));
  const counts = `counts as ${goal.completion_limit - goal.remaining + (picked !== null ? 1 : 0)}/${goal.completion_limit} weekly completions`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      eyebrow="Tiered goal · pick a tier"
      title={goal.name}
      footer={
        <>
          <button
            type="button"
            className="tb-dialog-btn"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="tb-dialog-btn is-primary"
            disabled={busy || picked === null}
            onClick={() => picked !== null && void onConfirm(picked)}
          >
            {busy ? 'Saving…' : picked !== null ? `Confirm +${picked}` : 'Confirm'}
          </button>
        </>
      }
    >
      {error && <p className="tb-error" style={{ marginBottom: 10 }}>{error}</p>}
      {goal.note && (
        <p
          style={{
            color: 'var(--tb-muted)',
            fontSize: 12,
            margin: '0 0 10px',
            lineHeight: 1.5,
          }}
        >
          {goal.note}
        </p>
      )}
      <div className="tb-tier-grid">
        {tierValues.map((t) => (
          <button
            type="button"
            key={t}
            className={`tb-tier-card ${picked === t ? 'is-on' : ''}`}
            onClick={() => setPicked(t)}
          >
            <div className="pts">+{t}</div>
            <div className="lbl">{tierLabel(t, tierValues)}</div>
          </button>
        ))}
      </div>
      <div className="tb-tier-summary">
        SELECTED · <b>{picked !== null ? `+${picked} PTS` : '—'}</b>
        {picked !== null && (
          <>
            {' '}· NEW BALANCE <b>{newBalance} PTS</b>
            {' '}· ${(newBalance * rate).toFixed(2)}
            {' '}· {counts}
          </>
        )}
        {picked === null && remaining > 0 && <span> · pick a tier above</span>}
      </div>
    </Dialog>
  );
}

function tierLabel(value: number, all: number[]): string {
  const min = Math.min(...all);
  const max = Math.max(...all);
  if (value === min) return 'Small';
  if (value === max) return 'Epic';
  const mid = all[Math.floor(all.length / 2)];
  if (value === mid) return 'Medium';
  if (value < mid) return 'Quick';
  return 'Long';
}
