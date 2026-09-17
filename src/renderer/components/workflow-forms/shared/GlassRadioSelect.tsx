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
          className={`text-[12px] font-medium text-text-muted ${isHorizontal ? 'shrink-0' : ''}`}
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
          aria-pressed={value === opt.value}
          className={`flex min-h-8 items-center gap-1.5 rounded-md px-2 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/30 ${
            isHorizontal
              ? 'cursor-pointer text-text-secondary hover:bg-surface-hover hover:text-text-primary'
              : 'w-full text-left hover:bg-surface-hover'
          } ${value === opt.value ? (isHorizontal ? 'text-text-primary font-medium' : 'bg-accent-muted font-medium text-accent') : ''}`}
        >
          <span
            className={`h-3.5 w-3.5 shrink-0 rounded-full ${value === opt.value ? 'bg-accent' : 'bg-border-muted'}`}
            aria-hidden="true"
          />
          {opt.label}
        </button>
      ))}
    </div>
  );
}
