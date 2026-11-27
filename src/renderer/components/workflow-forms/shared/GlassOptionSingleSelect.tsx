import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { computeDropdownPlacement, useDropdown } from '../../../hooks/useDropdown';
import { computeDropdownWidth, measureMaxTextWidth } from './dropdownWidth';

function flattenItems(groups: GlassOptionGroup[]): GlassOptionItem[] {
  const result: GlassOptionItem[] = [];
  for (const g of groups) {
    for (const o of g.items) {
      result.push(o);
    }
  }
  return result;
}

interface GlassOptionGroup {
  key: string;
  header?: string;
  items: GlassOptionItem[];
}

interface GlassOptionItem {
  value: string;
  label: string;
  title?: string;
  icon?: ReactNode;
  /** Short secondary line shown under the label in the open list. */
  description?: string;
}

interface GlassOptionSingleSelectProps {
  value: string;
  groups: GlassOptionGroup[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  variant?: 'default' | 'highlight' | 'muted';
  /** Icon shown in the trigger instead of the selected item's own icon. */
  triggerIcon?: ReactNode;
  ariaLabel?: string;
  testId?: string;
}

export function GlassOptionSingleSelect({
  value,
  groups,
  disabled,
  onChange,
  className,
  placeholder,
  variant = 'default',
  triggerIcon,
  ariaLabel,
  testId,
}: GlassOptionSingleSelectProps) {
  const {
    open,
    setOpen,
    position,
    setPosition,
    maxHeight,
    setMaxHeight,
    triggerRef,
    dropdownRef,
    close,
  } = useDropdown();
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const flattenedItems = useMemo(() => flattenItems(groups), [groups]);

  const selectedItem = useMemo(() => {
    for (const g of groups) {
      for (const o of g.items) {
        if (o.value === value) return o;
      }
    }
    return undefined;
  }, [value, groups]);
  const selectedLabel = selectedItem?.label ?? value;

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const hasIcon = flattenedItems.some((item) => item.icon);
    const contentWidth = Math.max(
      measureMaxTextWidth(flattenedItems.map((item) => item.label)) + (hasIcon ? 32 : 0),
      measureMaxTextWidth(
        flattenedItems.flatMap((item) => (item.description ? [item.description] : [])),
        11.5
      ) + (hasIcon ? 32 : 0)
    );
    const dropdownWidth = computeDropdownWidth(rect.width, contentWidth);
    const placement = computeDropdownPlacement(rect);
    const viewportWidth = window.innerWidth || 1024;
    const left = Math.min(rect.left, Math.max(8, viewportWidth - dropdownWidth.minWidth - 8));
    setMaxHeight(placement.maxHeight);
    setPosition({
      left,
      top: placement.top,
      bottom: placement.bottom,
      width: dropdownWidth.minWidth,
      ...dropdownWidth,
    });
  }, [flattenedItems, triggerRef, setPosition, setMaxHeight]);

  const toggleOpen = useCallback(() => {
    if (open) {
      close();
    } else {
      updatePosition();
      setOpen(true);
      const idx = flattenedItems.findIndex((o) => o.value === value);
      setHighlightedIndex(Math.max(0, idx));
    }
  }, [open, close, updatePosition, flattenedItems, value, setOpen]);

  const handleTriggerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleOpen();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (open) {
          const el = dropdownRef.current?.querySelector(
            `[data-index="${highlightedIndex}"]`
          ) as HTMLElement | null;
          el?.focus();
        } else {
          toggleOpen();
        }
      } else if (e.key === 'Escape') {
        if (open) close();
      }
    },
    [close, dropdownRef, highlightedIndex, open, toggleOpen]
  );

  const handleDropdownKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        triggerRef.current?.focus();
        return;
      }
      if (flattenedItems.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.min(flattenedItems.length - 1, prev + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const opt = flattenedItems[highlightedIndex];
        if (opt) {
          onChange(opt.value);
          close();
        }
      }
    },
    [close, flattenedItems, highlightedIndex, onChange, triggerRef]
  );

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open) return;
    const el = dropdownRef.current?.querySelector(
      `[data-index="${highlightedIndex}"]`
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [dropdownRef, highlightedIndex, open]);

  // Focus highlighted option on open so keyboard navigation works immediately
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      const el = dropdownRef.current?.querySelector(
        `[data-index="${highlightedIndex}"]`
      ) as HTMLElement | null;
      el?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [dropdownRef, highlightedIndex, open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={toggleOpen}
        onKeyDown={handleTriggerKeyDown}
        aria-label={ariaLabel}
        title={selectedItem?.description}
        data-testid={testId}
        className={`flex min-h-8 items-center rounded border text-ui-body outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-40 ${
          variant === 'highlight'
            ? 'border-transparent bg-[rgb(var(--color-surface-active-rgb))] text-accent-text'
            : variant === 'muted'
              ? 'border-border-subtle/80 bg-surface-hover/45 text-text-secondary'
              : 'border-border-muted bg-surface text-text-secondary'
        } ${className ?? ''}`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate whitespace-nowrap pl-2 pr-1 text-left">
          {value ? (
            <>
              {triggerIcon ?? selectedItem?.icon}
              <span className="truncate">{selectedLabel}</span>
            </>
          ) : placeholder ? (
            <span className="text-text-muted">{placeholder}</span>
          ) : (
            selectedLabel
          )}
        </span>
        <ChevronDown
          className={`mr-0.5 h-3.5 w-3.5 flex-shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={dropdownRef}
            onKeyDown={handleDropdownKeyDown}
            role="listbox"
            style={{
              left: position.left,
              top: position.top ?? undefined,
              bottom: position.bottom ?? undefined,
              width: position.width,
              minWidth: position.minWidth,
              maxWidth: position.maxWidth,
              maxHeight,
            }}
            className="operator-ui scrollbar-hover fixed z-[10000] overflow-y-auto rounded-lg border border-border-muted bg-surface p-1 shadow-elevated"
          >
            {groups.map((g, gi) => (
              <div key={g.key} className="space-y-0.5">
                {gi > 0 && !g.header && <div className="my-1 border-t border-border-subtle" />}
                {g.header && (
                  <div
                    className={`px-2.5 py-1 text-ui-label font-medium text-text-muted ${
                      gi > 0 ? 'mt-1 border-t border-border-subtle pt-1.5' : ''
                    }`}
                  >
                    {g.header}
                  </div>
                )}
                {g.items.map((o, oi) => {
                  const globalIdx =
                    groups.slice(0, gi).reduce((sum, g) => sum + g.items.length, 0) + oi;
                  const selected = o.value === value;
                  const highlighted = globalIdx === highlightedIndex;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      title={o.title}
                      data-index={globalIdx}
                      className={`flex min-h-8 w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-ui-body outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30 ${
                        selected
                          ? 'bg-accent-muted font-medium text-accent'
                          : highlighted
                            ? 'bg-surface-hover text-text-primary'
                            : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                      }`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onChange(o.value);
                        close();
                      }}
                      onMouseEnter={() => setHighlightedIndex(globalIdx)}
                    >
                      {o.description ? (
                        <span className="flex min-w-0 flex-1 items-start gap-2">
                          {o.icon && <span className="mt-px inline-flex shrink-0">{o.icon}</span>}
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate">{o.label}</span>
                            <span className="whitespace-normal text-ui-caption font-normal leading-4 text-text-muted">
                              {o.description}
                            </span>
                          </span>
                        </span>
                      ) : (
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          {o.icon && <span className="inline-flex shrink-0">{o.icon}</span>}
                          <span className="min-w-0 flex-1 truncate">{o.label}</span>
                        </span>
                      )}
                      {selected && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
