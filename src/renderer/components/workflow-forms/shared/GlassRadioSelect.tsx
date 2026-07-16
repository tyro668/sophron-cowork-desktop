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
  direction?: 'vertical' | 'horizontal';
}

export function GlassRadioSelect({
  value,
  options,
  onChange,
  label,
  direction = 'vertical',
}: GlassRadioSelectProps) {
  const isHorizontal = direction === 'horizontal';

  return (
    <div className={isHorizontal ? 'flex items-center gap-2' : 'flex flex-col gap-1.5'}>
      {label && (
        <div
          className={`text-[11px] font-medium text-text-muted ${isHorizontal ? 'shrink-0' : ''}`}
        >
          {label}
        </div>
      )}
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          title={opt.tip}
          onClick={() => onChange(opt.value)}
          className={`flex items-center gap-1 text-[12px] transition-colors ${
            isHorizontal
              ? 'cursor-pointer text-text-secondary hover:text-text-primary'
              : 'w-full rounded-md px-2 py-1.5 text-left hover:bg-surface-hover'
          } ${value === opt.value ? (isHorizontal ? 'text-text-primary font-medium' : 'bg-accent/10 font-medium text-accent') : ''}`}
        >
          <span
            className={`h-3 w-3 shrink-0 rounded-full ${value === opt.value ? 'bg-accent' : 'bg-border-muted'}`}
            aria-hidden="true"
          />
          {opt.label}
        </button>
      ))}
    </div>
  );
}
