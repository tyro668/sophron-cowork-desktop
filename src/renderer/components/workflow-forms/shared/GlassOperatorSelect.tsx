import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

function flattenItems(groups: GlassOperatorGroup[]): GlassOperatorOption[] {
  const result: GlassOperatorOption[] = [];
  for (const g of groups) {
    for (const o of g.items) {
      result.push(o);
    }
  }
  return result;
}

interface GlassOperatorGroup {
  key: string;
  items: GlassOperatorOption[];
}

interface GlassOperatorOption {
  value: string;
  label: string;
}

interface GlassOperatorSelectProps {
  value: string;
  groups: GlassOperatorGroup[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

export function GlassOperatorSelect({
  value,
  groups,
  disabled,
  onChange,
  className,
  placeholder,
}: GlassOperatorSelectProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(
    null
  );
  const [maxHeight, setMaxHeight] = useState(240);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    setPosition({ left: rect.left, top: rect.bottom + 2, width: rect.width });
    const spaceBelow = window.innerHeight - rect.bottom - 4;
    setMaxHeight(Math.min(240, Math.max(100, spaceBelow)));
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  // Click outside
  useEffect(() => {
    if (!open) return;
    const handleDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        handleClose();
      }
    };
    document.addEventListener('mousedown', handleDocClick);
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, [open, handleClose]);

  // Close on resize
  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', handleClose);
    return () => window.removeEventListener('resize', handleClose);
  }, [open, handleClose]);

  function toggleOpen() {
    if (open) {
      handleClose();
    } else {
      updatePosition();
      setOpen(true);
      const idx = flattenedItems.findIndex((o) => o.value === value);
      setHighlightedIndex(Math.max(0, idx));
    }
  }

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
        if (open) handleClose();
      }
    },
    [open, highlightedIndex]
  );

  const handleDropdownKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
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
          handleClose();
        }
      }
    },
    [flattenedItems, highlightedIndex, onChange, handleClose]
  );

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open) return;
    const el = dropdownRef.current?.querySelector(
      `[data-index="${highlightedIndex}"]`
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, open]);

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
  }, [open, highlightedIndex]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={toggleOpen}
        onKeyDown={handleTriggerKeyDown}
        className={`flex items-center rounded border border-border-muted bg-background/42 text-text-secondary outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-40 ${className ?? ''}`}
      >
        <span className="flex-1 px-2 text-center whitespace-nowrap truncate">
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
            style={{ left: position.left, top: position.top, width: position.width, maxHeight }}
            className="fixed z-50 overflow-y-auto rounded-lg border border-border-muted bg-[var(--glass-card-strong)] py-1 shadow-elevated backdrop-blur-xl"
          >
            {groups.map((g, gi) => (
              <div key={g.key}>
                {gi > 0 && <div className="mx-3 my-0.5 border-t border-border-muted" />}
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
                      data-index={globalIdx}
                      className={`w-full whitespace-nowrap px-3 py-1.5 text-center text-[12px] transition-colors ${
                        selected
                          ? 'text-accent font-medium bg-accent/10 ring-1 ring-inset ring-accent/20'
                          : 'text-text-secondary hover:bg-surface-hover'
                      } ${globalIdx === highlightedIndex && !selected ? 'bg-surface-hover' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onChange(o.value);
                        handleClose();
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
