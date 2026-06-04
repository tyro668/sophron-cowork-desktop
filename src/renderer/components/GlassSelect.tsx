import * as Select from '@radix-ui/react-select';
import type { ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

const EMPTY_SELECT_VALUE = '__sophron_glass_select_empty_value__';

export interface GlassSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface GlassSelectProps {
  value?: string;
  options: GlassSelectOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  triggerIcon?: ReactNode;
  triggerClassName?: string;
  contentClassName?: string;
  side?: Select.SelectContentProps['side'];
  align?: Select.SelectContentProps['align'];
  sideOffset?: number;
}

export function GlassSelect({
  value,
  options,
  onValueChange,
  placeholder,
  open,
  onOpenChange,
  disabled = false,
  triggerIcon,
  triggerClassName,
  contentClassName,
  side = 'bottom',
  align = 'start',
  sideOffset = 8,
}: GlassSelectProps) {
  const normalizedValue = value === undefined ? undefined : normalizeSelectValue(value);
  const normalizedOptions = options.map((option) => ({
    ...option,
    value: normalizeSelectValue(option.value),
  }));

  return (
    <Select.Root
      value={normalizedValue}
      onValueChange={(nextValue) => onValueChange(denormalizeSelectValue(nextValue))}
      open={open}
      onOpenChange={onOpenChange}
      disabled={disabled}
    >
      <Select.Trigger
        className={cx(
          'inline-flex h-8 min-w-0 items-center gap-1.5 rounded-lg border border-border-muted bg-background/62 px-2.5 text-[13px] font-medium text-text-secondary shadow-soft outline-none transition-colors hover:bg-surface-hover hover:text-text-primary focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50',
          triggerClassName
        )}
      >
        {triggerIcon}
        <Select.Value placeholder={placeholder} />
        <Select.Icon asChild>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={12}
          className={cx(
            'z-50 max-h-64 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-border-subtle bg-[var(--glass-card-strong)] shadow-elevated backdrop-blur-xl',
            contentClassName
          )}
        >
          <Select.Viewport className="p-1">
            {normalizedOptions.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="flex min-h-8 cursor-default select-none items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium text-text-secondary outline-none transition-colors hover:bg-background/58 hover:text-text-primary focus:bg-background/58 focus:text-text-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[state=checked]:bg-accent/10 data-[state=checked]:text-text-primary data-[state=checked]:ring-1 data-[state=checked]:ring-inset data-[state=checked]:ring-accent/20"
              >
                <Select.ItemText>
                  <span className="truncate">{option.label}</span>
                </Select.ItemText>
                <Select.ItemIndicator className="ml-auto">
                  <Check className="h-4 w-4 text-accent" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

function normalizeSelectValue(value: string): string {
  return value === '' ? EMPTY_SELECT_VALUE : value;
}

function denormalizeSelectValue(value: string): string {
  return value === EMPTY_SELECT_VALUE ? '' : value;
}
