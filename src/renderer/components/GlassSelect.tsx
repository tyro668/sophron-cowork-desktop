import * as Select from '@radix-ui/react-select';
import { useState, type ReactNode } from 'react';
import { Check, ChevronDown, Loader2, Search } from 'lucide-react';
import { cn, selectContentClass, selectItemClass, selectTriggerClass } from './ui';

const EMPTY_SELECT_VALUE = '__sophron_glass_select_empty_value__';

export interface GlassSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Options sharing a group key render under one header (in first-seen order). */
  group?: string;
  groupLabel?: string;
  /** Short muted text after the group label (e.g. "3" or "合并"). */
  groupMeta?: string;
  /** Extra text matched by the search box (e.g. the source name). */
  searchText?: string;
  /** Muted text after the label (e.g. "720 行"). */
  hint?: string;
  /** Greyed out but still selectable. */
  muted?: boolean;
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
  /** Spinner in place of the chevron while options load. */
  loading?: boolean;
  /** Fixed content below the option list (e.g. 「加载更多」). */
  footer?: ReactNode;
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
  loading = false,
  footer,
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
          option.value === normalizedValue ||
          option.label.toLowerCase().includes(normalizedSearch) ||
          (option.searchText ?? '').toLowerCase().includes(normalizedSearch)
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
          {loading ? (
            <Loader2
              className="h-3.5 w-3.5 shrink-0 animate-spin text-text-muted"
              data-testid="glass-select-loading"
            />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          )}
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
            (searchable || footer) && 'flex flex-col',
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
          <Select.Viewport
            className={cn('p-1', (searchable || footer) && 'min-h-0 flex-1 overflow-y-auto')}
          >
            {searchable && visibleOptions.length === 0 && (
              <div className="px-2.5 py-3 text-center text-[12px] text-text-muted">
                {searchEmptyText}
              </div>
            )}
            {groupOptions(visibleOptions).map((section) => {
              const items = section.options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className={cn(
                    selectItemClass,
                    'min-h-8',
                    section.key && 'pl-5',
                    option.muted && 'text-text-muted'
                  )}
                >
                  <Select.ItemText>
                    <span className="truncate">{option.label}</span>
                  </Select.ItemText>
                  {option.hint ? (
                    <span className="ml-2 flex-shrink-0 truncate pr-5 text-[11.5px] text-text-muted">
                      {option.hint}
                    </span>
                  ) : null}
                  <Select.ItemIndicator className="absolute right-1.5 flex items-center text-accent-text">
                    <Check className="h-3.5 w-3.5" />
                  </Select.ItemIndicator>
                </Select.Item>
              ));
              if (!section.key) return items;
              return (
                <Select.Group key={`group:${section.key}`} data-testid="glass-select-group">
                  <Select.Label className="flex items-center gap-1.5 px-2 pb-0.5 pt-1.5 text-[11.5px] font-medium text-text-secondary">
                    <span className="truncate">{section.label}</span>
                    {section.meta ? (
                      <span className="rounded bg-surface-hover px-1 text-[10.5px] text-text-muted">
                        {section.meta}
                      </span>
                    ) : null}
                  </Select.Label>
                  {items}
                </Select.Group>
              );
            })}
          </Select.Viewport>
          {footer ? (
            <div className="flex-shrink-0 border-t border-border-subtle">{footer}</div>
          ) : null}
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

type OptionSection<T extends GlassSelectOption> = {
  key: string | null;
  label: string;
  meta?: string;
  options: T[];
};

/** Consecutive ungrouped options stay flat; grouped ones collect under their first header. */
export function groupOptions<T extends GlassSelectOption>(options: T[]): OptionSection<T>[] {
  const sections: OptionSection<T>[] = [];
  const byKey = new Map<string, OptionSection<T>>();
  for (const option of options) {
    if (!option.group) {
      const last = sections[sections.length - 1];
      if (last && last.key === null) last.options.push(option);
      else sections.push({ key: null, label: '', options: [option] });
      continue;
    }
    let section = byKey.get(option.group);
    if (!section) {
      section = {
        key: option.group,
        label: option.groupLabel ?? option.group,
        meta: option.groupMeta,
        options: [],
      };
      byKey.set(option.group, section);
      sections.push(section);
    }
    section.options.push(option);
  }
  return sections;
}

function normalizeSelectValue(value: string): string {
  return value === '' ? EMPTY_SELECT_VALUE : value;
}

function denormalizeSelectValue(value: string): string {
  return value === EMPTY_SELECT_VALUE ? '' : value;
}
