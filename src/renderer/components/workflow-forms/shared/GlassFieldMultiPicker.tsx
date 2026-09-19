import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Trash2 } from 'lucide-react';
import { computeDropdownPlacement, useDropdown } from '../../../hooks/useDropdown';
import { useFormTranslation } from '../../../hooks/useFormTranslation';
import { computeDropdownWidth, measureMaxTextWidth } from './dropdownWidth';
import { GlassFieldMultiSelect, type SelectionMode } from './GlassFieldMultiSelect';
import { GlassOverflowTagList } from './GlassOverflowTagList';
import { GlassValueChip } from './GlassValueChip';

interface GlassFieldMultiPickerProps {
  columns: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  /** Per-value remove override; defaults to dropping the value via onChange. */
  onRemove?: (item: string) => void;
  /** Renders the clear-all button when provided. */
  onClear?: () => void;
  columnTypes?: Record<string, string>;
  placeholder?: string;
  disabled?: boolean;
  maxHeight?: string;
  /** Chip row behavior: collapse into a "+N" badge (compact field rows) or
   *  scroll horizontally inline. */
  overflow?: 'collapse' | 'scroll';
  /** Controlled open state — pass `open` + `onToggle` together; omit both for
   *  the self-managed dropdown. */
  open?: boolean;
  onToggle?: () => void;
  /** `portal` mounts the list on document.body (escapes overflow containers);
   *  `inline` expands below the trigger inside the layout flow. */
  dropdown?: 'portal' | 'inline';
  selectionMode?: SelectionMode;
  variant?: 'flat' | 'glass';
  itemExtras?: (column: string) => ReactNode;
  columnLabel?: (column: string) => string;
  className?: string;
}

/**
 * The single multi-field picker: bordered h-8 trigger (optional clear-all,
 * GlassValueChip row, segmented chevron) plus a GlassFieldMultiSelect list
 * rendered either as a floating portal panel or inline below the trigger.
 */
export function GlassFieldMultiPicker({
  columns,
  selected,
  onChange,
  onRemove,
  onClear,
  columnTypes,
  placeholder,
  disabled = false,
  maxHeight = '220px',
  overflow = 'collapse',
  open,
  onToggle,
  dropdown = 'portal',
  selectionMode,
  variant,
  itemExtras,
  columnLabel,
  className = '',
}: GlassFieldMultiPickerProps) {
  const tr = useFormTranslation('fieldPicker');
  const internal = useDropdown<HTMLDivElement>();
  const isControlled = open !== undefined;
  const isOpen = open ?? internal.open;

  const updatePosition = useCallback(() => {
    const rect = internal.triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const contentWidth = measureMaxTextWidth(columns);
    const dropdownWidth = computeDropdownWidth(rect.width, contentWidth);
    const placement = computeDropdownPlacement(rect);
    internal.setMaxHeight(placement.maxHeight);
    internal.setPosition({
      left: rect.left,
      top: placement.top,
      bottom: placement.bottom,
      width: rect.width,
      ...dropdownWidth,
    });
  }, [columns, internal]);

  const toggle = useCallback(() => {
    if (disabled) return;
    if (isControlled) {
      onToggle?.();
      return;
    }
    if (isOpen) {
      internal.close();
    } else {
      updatePosition();
      internal.setOpen(true);
    }
  }, [disabled, isControlled, isOpen, onToggle, internal, updatePosition]);

  useEffect(() => {
    if (disabled && isOpen && !isControlled) internal.close();
  }, [disabled, isOpen, isControlled, internal]);

  const removeItem = useCallback(
    (item: string) => {
      if (onRemove) {
        onRemove(item);
      } else {
        onChange(selected.filter((value) => value !== item));
      }
    },
    [onRemove, onChange, selected]
  );

  // Configured values absent from the option list stay visible as flagged
  // chips — "pending inference" when no columns resolved yet, otherwise
  // "not found" so stale config can be repaired instead of silently dropped.
  const missingValues = useMemo(
    () => new Set(selected.filter((value) => !columns.includes(value))),
    [columns, selected]
  );
  const missingTitle = columns.length === 0 ? tr('fieldPendingInference') : tr('fieldNotFound');

  const list = (
    <GlassFieldMultiSelect
      columns={columns}
      selected={selected}
      onChange={onChange}
      columnTypes={columnTypes}
      maxHeight={maxHeight}
      selectionMode={selectionMode}
      variant={variant}
      borderless={dropdown === 'portal'}
      itemExtras={itemExtras}
      columnLabel={columnLabel}
      className={dropdown === 'inline' ? '-mt-px rounded-t-none' : ''}
    />
  );

  return (
    <div className="grid min-w-0 gap-0">
      <div
        ref={internal.triggerRef}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-expanded={isOpen}
        onMouseDown={(event) => {
          if (disabled) return;
          if ((event.target as HTMLElement).closest('button')) return;
          event.preventDefault();
          toggle();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return;
          if ((event.target as HTMLElement).closest('button')) return;
          event.preventDefault();
          toggle();
        }}
        className={`relative flex h-8 min-h-8 w-full min-w-0 items-center overflow-hidden rounded-md border border-border-muted bg-surface pl-[5px] text-[13px] outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 ${
          isOpen && dropdown === 'inline' ? 'rounded-b-none' : ''
        } ${
          disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-surface-hover'
        } ${className}`}
      >
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center self-center rounded text-text-muted outline-none transition-colors hover:bg-error/10 hover:text-error focus-visible:ring-2 focus-visible:ring-accent/30"
            title={tr('clearAll')}
            aria-label={tr('clearAll')}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}

        {overflow === 'scroll' ? (
          <div className="scrollbar-hover flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            {selected.length === 0 && placeholder && (
              <span className="flex-shrink-0 whitespace-nowrap text-[12px] italic text-text-muted">
                {placeholder}
              </span>
            )}
            {selected.map((item, index) => (
              <GlassValueChip
                key={`${item}-${index}`}
                label={item}
                missing={missingValues.has(item)}
                missingTitle={missingTitle}
                onRemove={() => removeItem(item)}
                removeAriaLabel={tr('removeField')}
              />
            ))}
          </div>
        ) : (
          <GlassOverflowTagList
            values={selected}
            onRemove={(index) => removeItem(selected[index])}
            disabled={disabled}
            placeholder={placeholder}
            missing={missingValues}
            missingTitle={missingTitle}
          />
        )}

        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            toggle();
          }}
          className="flex w-8 flex-shrink-0 items-center justify-center self-stretch rounded-r-md border-l border-border-muted text-text-muted outline-none transition-colors hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30"
          aria-label={tr('selectField')}
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {dropdown === 'inline' && isOpen && list}

      {dropdown === 'portal' &&
        isOpen &&
        internal.position &&
        createPortal(
          <div
            ref={internal.dropdownRef}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              if (isControlled) {
                onToggle?.();
              } else {
                internal.close();
              }
            }}
            style={{
              left: internal.position.left,
              top: internal.position.top ?? undefined,
              bottom: internal.position.bottom ?? undefined,
              width: internal.position.width,
              minWidth: internal.position.minWidth,
              maxWidth: internal.position.maxWidth,
              maxHeight: internal.maxHeight,
            }}
            className="operator-ui fixed z-50 overflow-hidden rounded-lg border border-border-muted bg-surface shadow-elevated"
          >
            {list}
          </div>,
          document.body
        )}
    </div>
  );
}
