import { Check, Minus } from 'lucide-react';
import { cn } from '../ui';

export function PickerCheck(opts: {
  checked: boolean;
  disabled?: boolean;
  indeterminate?: boolean;
  label: string;
  onChange: () => void;
}) {
  const filled = (opts.checked || opts.indeterminate) && !opts.disabled;
  return (
    <span className="relative inline-flex h-4 w-4 flex-shrink-0 items-center justify-center">
      <input
        type="checkbox"
        checked={opts.checked && !opts.indeterminate}
        disabled={opts.disabled}
        ref={(el) => {
          if (el) el.indeterminate = Boolean(opts.indeterminate);
        }}
        onChange={opts.onChange}
        onClick={(event) => event.stopPropagation()}
        className="peer absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        aria-label={opts.label}
      />
      <span
        className={cn(
          'flex h-4 w-4 items-center justify-center border',
          filled
            ? 'border-accent bg-accent text-accent-foreground'
            : 'border-border bg-surface text-transparent',
          opts.disabled && 'border-border-subtle bg-surface-muted text-text-muted'
        )}
      >
        {opts.indeterminate && !opts.disabled ? (
          <Minus className="h-3 w-3" strokeWidth={3} />
        ) : opts.checked ? (
          <Check className="h-3 w-3" strokeWidth={3} />
        ) : null}
      </span>
    </span>
  );
}
