import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { Icon } from '../icons/Icon';
import { TrackeeView } from '../../auth/api';

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (amount: number) => Promise<void> | void;
  balance: number;
  rate: number;
  admins: TrackeeView[];
  busy?: boolean;
  error?: string | null;
}

export function CashOutDialog({
  open,
  onClose,
  onConfirm,
  balance,
  rate,
  admins,
  busy,
  error,
}: Props) {
  const [amount, setAmount] = useState<string>(String(Math.max(0, balance)));

  useEffect(() => {
    if (open) setAmount(String(Math.max(0, balance)));
  }, [open, balance]);

  const numeric = Number(amount);
  const invalid = !Number.isInteger(numeric) || numeric <= 0 || numeric > balance;
  const adminLabel =
    admins.length === 0
      ? 'an Admin'
      : admins.map((a) => a.display_name).join(' or ');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      eyebrow="Cash-out · request"
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <Icon name="coin" size={22} color="var(--tb-primary)" stroke={2.4} />
          Cash out your points?
        </span>
      }
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
            disabled={busy || invalid}
            onClick={() => void onConfirm(numeric)}
          >
            {busy ? 'Sending…' : 'Send request'}
          </button>
        </>
      }
    >
      {error && <p className="tb-error" style={{ marginBottom: 10 }}>{error}</p>}
      <div className="tb-cashout-grid">
        <div className="tb-cashout-col">
          <h5>You have</h5>
          <div className="num">{balance}</div>
          <div className="dollars">= ${(balance * rate).toFixed(2)}</div>
        </div>
        <div className="tb-cashout-col">
          <h5>Cashing out</h5>
          <input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9-]/g, ''))}
            aria-label="Cash-out amount"
            disabled={busy}
          />
          <div className="dollars">
            = $
            {Number.isFinite(numeric) ? (numeric * rate).toFixed(2) : '—'}
          </div>
        </div>
      </div>
      <p
        style={{
          marginTop: 16,
          color: 'var(--tb-muted)',
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        This sends a cash-out request to {adminLabel}. No points move until they
        commit it on the admin browser. They can pay any partial amount.
      </p>
    </Dialog>
  );
}
