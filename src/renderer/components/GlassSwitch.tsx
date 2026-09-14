import * as Switch from '@radix-ui/react-switch';

interface GlassSwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}

export function GlassSwitch({
  checked,
  onCheckedChange,
  disabled = false,
  ariaLabel,
  className,
}: GlassSwitchProps) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={`relative inline-flex h-7 w-[52px] flex-shrink-0 items-center rounded-full border p-[3px] outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-55 ${
        checked ? 'border-accent bg-accent' : 'border-border bg-surface-active'
      } ${className ?? ''}`}
      aria-label={ariaLabel}
    >
      <Switch.Thumb
        className={`block h-[22px] w-[22px] transform-gpu rounded-full bg-white shadow-soft ring-1 transition-transform duration-150 ease-out will-change-transform ${
          checked ? 'translate-x-6 ring-white/70' : 'translate-x-0 ring-border-muted'
        }`}
      />
    </Switch.Root>
  );
}
