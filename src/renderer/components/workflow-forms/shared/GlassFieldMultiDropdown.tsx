import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { computeDropdownPlacement, useDropdown } from '../../../hooks/useDropdown';
import { computeDropdownWidth, measureMaxTextWidth } from './dropdownWidth';
import { GlassFieldMultiSelect } from './GlassFieldMultiSelect';
import { GlassOverflowTagList } from './GlassOverflowTagList';

interface GlassFieldMultiDropdownProps {
  columns: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  columnTypes?: Record<string, string>;
  placeholder?: string;
  disabled?: boolean;
  maxHeight?: string;
  className?: string;
}

/**
 * Dropdown-style multi field picker. Its trigger shares the filter value
 * picker's one-line tags and "+N" overflow badge.
 */
export function GlassFieldMultiDropdown({
  columns,
  selected,
  onChange,
  columnTypes,
  placeholder,
  disabled = false,
  maxHeight = '220px',
  className = '',
}: GlassFieldMultiDropdownProps) {
  const {
    open,
    setOpen,
    position,
    setPosition,
    maxHeight: dropdownMaxHeight,
    setMaxHeight,
    triggerRef,
    dropdownRef,
    close,
  } = useDropdown<HTMLDivElement>();

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const contentWidth = measureMaxTextWidth(columns);
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
  }, [columns, triggerRef, setPosition, setMaxHeight]);

  const toggleOpen = useCallback(() => {
    if (disabled) return;
    if (open) {
      close();
    } else {
      updatePosition();
      setOpen(true);
    }
  }, [disabled, open, close, updatePosition, setOpen]);

  useEffect(() => {
    if (disabled && open) close();
  }, [disabled, open, close]);

  const removeSelected = useCallback(
    (index: number) => onChange(selected.filter((_, itemIndex) => itemIndex !== index)),
    [onChange, selected]
  );

  return (
    <>
      <div
        ref={triggerRef}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-expanded={open}
        onMouseDown={(e) => {
          e.preventDefault();
          toggleOpen();
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          toggleOpen();
        }}
        className={`relative flex h-9 min-w-0 items-center gap-1.5 rounded-md border border-border-muted bg-background/42 py-[5px] pl-[5px] pr-2 text-[13px] outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 ${
          disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-surface-hover'
        } ${className}`}
      >
        <GlassOverflowTagList
          values={selected}
          onRemove={removeSelected}
          disabled={disabled}
          placeholder={placeholder}
          variant="field"
        />
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </div>

      {open &&
        position &&
        createPortal(
          <div
            ref={dropdownRef}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.preventDefault();
              close();
            }}
            style={{
              left: position.left,
              top: position.top ?? undefined,
              bottom: position.bottom ?? undefined,
              width: position.width,
              minWidth: position.minWidth,
              maxWidth: position.maxWidth,
              maxHeight: dropdownMaxHeight,
            }}
            className="operator-ui fixed z-50 overflow-hidden rounded-lg border border-border-muted bg-[var(--glass-card-strong)] shadow-elevated backdrop-blur-xl"
          >
            <GlassFieldMultiSelect
              columns={columns}
              selected={selected}
              onChange={onChange}
              columnTypes={columnTypes}
              maxHeight={maxHeight}
              borderless
            />
          </div>,
          document.body
        )}
    </>
  );
}
