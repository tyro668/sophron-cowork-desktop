import { Switch } from './ui';

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
    <Switch
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={className}
      aria-label={ariaLabel}
    />
  );
}
