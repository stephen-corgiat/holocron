interface Props {
  on: boolean;
  label: string;
  help?: string;
  onChange: (v: boolean) => void;
}

/**
 * Cyan-filled checkbox row shared across the admin editors (goals, tasks) so
 * the flag toggles read identically everywhere.
 */
export function CheckRow({ on, label, help, onChange }: Props) {
  return (
    <label className="goals-check-row">
      <span className={`goals-check-box ${on ? 'is-on' : ''}`}>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => onChange(e.target.checked)}
        />
        {on && <span aria-hidden>✓</span>}
      </span>
      <span className="goals-check-text">
        <span className="goals-check-label">{label}</span>
        {help && <span className="goals-check-help">{help}</span>}
      </span>
    </label>
  );
}
