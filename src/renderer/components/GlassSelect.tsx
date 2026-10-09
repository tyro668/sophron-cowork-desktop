import * as Select from '@radix-ui/react-select';
import { useState, type ReactNode } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
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
  /** Render a filter input at the top of the dropdown; options filter by label. */
  searchable?: boolean;
  searchPlaceholder?: string;
  searchEmptyText?: string;
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
  searchable = false,
  searchPlaceholder,
  searchEmptyText,
}: GlassSelectProps) {
  const [search, setSearch] = useState('');
  const normalizedValue = value === undefined ? undefined : normalizeSelectValue(value);
  const normalizedOptions = options.map((option) => ({
    ...option,
    value: normalizeSelectValue(option.value),
  }));
  const normalizedSearch = searchable ? search.trim().toLowerCase() : '';
  const visibleOptions = normalizedSearch
    ? normalizedOptions.filter(
        (option) =>
          option.value === normalizedValue || option.label.toLowerCase().includes(normalizedSearch)
      )
    : normalizedOptions;
  const selectedOption = normalizedOptions.find((option) => option.value === normalizedValue);
  const displayLabel = selectedOption?.label ?? placeholder ?? '';

  return (
    <Select.Root
      value={normalizedValue}
      onValueChange={(nextValue) => onValueChange(denormalizeSelectValue(nextValue))}
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setSearch('');
        onOpenChange?.(nextOpen);
      }}
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
            searchable && 'flex flex-col',
            contentClassName
          )}
        >
          {searchable && (
            <div className="flex min-h-8 items-center gap-1.5 border-b border-border-subtle px-2 py-1">
              <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" />
              <input
                ref={(element) => {
                  // Radix focuses the content wrapper on open; defer so the
                  // search input wins focus.
                  if (element) window.setTimeout(() => element.focus(), 0);
                }}
                autoFocus
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  // Keep Radix handling for navigation/dismiss keys; typing must
                  // not trigger option typeahead.
                  if (!['Escape', 'ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key)) {
                    event.stopPropagation();
                  }
                }}
                placeholder={searchPlaceholder}
                className="h-7 min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted"
              />
            </div>
          )}
          <Select.Viewport className={cn('p-1', searchable && 'min-h-0 flex-1 overflow-y-auto')}>
            {searchable && visibleOptions.length === 0 && (
              <div className="px-2.5 py-3 text-center text-[12px] text-text-muted">
                {searchEmptyText}
              </div>
            )}
            {visibleOptions.map((option) => (
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
