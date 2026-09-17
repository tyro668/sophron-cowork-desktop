import * as Select from '@radix-ui/react-select';
import type { ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn, selectContentClass, selectItemClass, selectTriggerClass } from './ui';

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
  ariaLabel?: string;
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
  ariaLabel,
  placeholder,
  open,
  onOpenChange,
  disabled = false,
  triggerIcon,
  triggerClassName,
  contentClassName,
  side = 'bottom',
  align = 'start',
  sideOffset = 2,
}: GlassSelectProps) {
  const normalizedValue = value === undefined ? undefined : normalizeSelectValue(value);
  const normalizedOptions = options.map((option) => ({
    ...option,
    value: normalizeSelectValue(option.value),
  }));
  const selectedOption = normalizedOptions.find((option) => option.value === normalizedValue);
  const displayLabel = selectedOption?.label ?? placeholder ?? '';

  return (
    <Select.Root
      value={normalizedValue}
      onValueChange={(nextValue) => onValueChange(denormalizeSelectValue(nextValue))}
      open={open}
      onOpenChange={onOpenChange}
      disabled={disabled}
    >
      <Select.Trigger
        aria-label={ariaLabel}
        className={cn(selectTriggerClass, 'min-w-0', triggerClassName)}
      >
        {triggerIcon}
        <span className="min-w-0 flex-1 truncate text-left">{displayLabel}</span>
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
          className={cn(
            selectContentClass,
            'min-w-[var(--radix-select-trigger-width)] max-h-64',
            contentClassName
          )}
        >
          <Select.Viewport className="p-1">
            {normalizedOptions.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cn(selectItemClass, 'min-h-8')}
              >
                <Select.ItemText>
                  <span className="truncate">{option.label}</span>
                </Select.ItemText>
                <Select.ItemIndicator className="absolute right-1.5 flex items-center text-accent-text">
                  <Check className="h-3.5 w-3.5" />
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
