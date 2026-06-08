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
      className={`relative inline-flex h-7 w-[52px] flex-shrink-0 items-center rounded-full border p-[3px] shadow-[inset_0_1px_2px_rgba(15,23,42,0.14)] outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-55 ${
        checked
          ? 'border-success bg-success'
          : 'border-[rgba(148,163,184,0.58)] bg-[rgba(148,163,184,0.32)]'
      } ${className ?? ''}`}
      aria-label={ariaLabel}
    >
      <Switch.Thumb
        className={`block h-[22px] w-[22px] transform-gpu rounded-full bg-white shadow-[0_2px_8px_rgba(15,23,42,0.22)] ring-1 transition-transform duration-150 ease-out will-change-transform ${
          checked ? 'translate-x-6 ring-white/70' : 'translate-x-0 ring-[rgba(100,116,139,0.38)]'
        }`}
      />
    </Switch.Root>
  );
}
