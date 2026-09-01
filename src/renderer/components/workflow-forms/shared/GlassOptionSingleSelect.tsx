import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
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
}

interface GlassOptionSingleSelectProps {
  value: string;
  groups: GlassOptionGroup[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  variant?: 'default' | 'highlight' | 'muted';
}

export function GlassOptionSingleSelect({
  value,
  groups,
  disabled,
  onChange,
  className,
  placeholder,
  variant = 'default',
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

  const selectedLabel = useMemo(() => {
    for (const g of groups) {
      for (const o of g.items) {
        if (o.value === value) return o.label;
      }
    }
    return value;
  }, [value, groups]);

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const contentWidth = measureMaxTextWidth(flattenedItems.map((item) => item.label));
    const dropdownWidth = computeDropdownWidth(rect.width, contentWidth);
    const placement = computeDropdownPlacement(rect);
    setMaxHeight(placement.maxHeight);
    setPosition({
      left: rect.left,
      top: placement.top,
      bottom: placement.bottom,
      width: rect.width,
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
        className={`flex min-h-7 items-center rounded border text-[13px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-40 ${
          variant === 'highlight'
            ? 'border-transparent bg-[rgb(var(--color-surface-active-rgb))] text-accent-text'
            : variant === 'muted'
              ? 'border-border-subtle/80 bg-surface-hover/45 text-text-secondary'
              : 'border-border-muted bg-background/42 text-text-secondary'
        } ${className ?? ''}`}
      >
        <span className="flex-1 truncate whitespace-nowrap px-2 text-left">
          {value ? (
            selectedLabel
          ) : placeholder ? (
            <span className="text-text-muted">{placeholder}</span>
          ) : (
            selectedLabel
          )}
        </span>
        <ChevronDown
          className={`mr-1 h-3.5 w-3.5 flex-shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
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
            className="operator-ui scrollbar-hover fixed z-50 overflow-y-auto rounded-lg border border-border-muted bg-[var(--glass-card-strong)] py-1 shadow-elevated backdrop-blur-xl"
          >
            {groups.map((g, gi) => (
              <div key={g.key}>
                {gi > 0 && !g.header && (
                  <div className="mx-3 my-0.5 border-t border-border-muted" />
                )}
                {g.header && (
                  <div className="px-3 py-1.5 text-[12px] font-medium text-text-muted uppercase">
                    {g.header}
                  </div>
                )}
                {g.items.map((o, oi) => {
                  const globalIdx =
                    groups.slice(0, gi).reduce((sum, g) => sum + g.items.length, 0) + oi;
                  const selected = o.value === value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      title={o.title}
                      data-index={globalIdx}
                      className={`min-h-7 w-full overflow-hidden text-ellipsis whitespace-nowrap px-3 py-1.5 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30 ${
                        selected
                          ? 'text-accent font-medium bg-accent/10 ring-1 ring-inset ring-accent/20'
                          : 'text-text-secondary hover:bg-surface-hover'
                      } ${globalIdx === highlightedIndex && !selected ? 'bg-surface-hover' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onChange(o.value);
                        close();
                      }}
                      onMouseEnter={() => setHighlightedIndex(globalIdx)}
                    >
                      {o.label}
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
