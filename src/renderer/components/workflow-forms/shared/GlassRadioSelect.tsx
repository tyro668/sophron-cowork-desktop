interface RadioOption {
  value: string;
  label: string;
  tip?: string;
}

interface GlassRadioSelectProps {
  value: string;
  options: RadioOption[];
  onChange: (value: string) => void;
  label?: string;
}

export function GlassRadioSelect({ value, options, onChange, label }: GlassRadioSelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <div className="text-[11px] font-medium text-text-muted">{label}</div>}
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          title={opt.tip}
          onClick={() => onChange(opt.value)}
          className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors ${
            value === opt.value
              ? 'bg-accent/10 font-medium text-accent'
              : 'text-text-secondary hover:bg-surface-hover'
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${value === opt.value ? 'bg-accent' : 'bg-border-muted'}`}
            aria-hidden="true"
          />
          {opt.label}
        </button>
      ))}
    </div>
  );
}
