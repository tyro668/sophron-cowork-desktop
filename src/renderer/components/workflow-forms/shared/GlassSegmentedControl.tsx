import type { ReactNode } from 'react';

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  tip?: string;
  icon?: ReactNode;
}

interface GlassSegmentedControlProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
}

export function GlassSegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: GlassSegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-md border border-border-muted bg-background/60 p-0.5"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          title={opt.tip}
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`inline-flex h-[27px] items-center gap-1.5 rounded px-3 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/30 ${
            value === opt.value
              ? 'bg-surface-active font-medium text-accent-text'
              : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
          }`}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
