interface Props {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  title?: string;
}

/**
 * Single-choice segmented control — the cyan "radio" bar used across the admin
 * editors (goals, tasks). One visual home so the surfaces stay consistent.
 */
export function Segmented({ options, value, onChange, disabled, title }: Props) {
  return (
    <div className="goals-segmented" title={title}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`goals-segmented-btn ${o.value === value ? 'is-on' : ''}`}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
