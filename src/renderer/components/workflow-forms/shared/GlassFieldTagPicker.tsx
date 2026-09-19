import { useMemo, type ReactNode } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { useFormTranslation } from '../../../hooks/useFormTranslation';
import { GlassFieldMultiSelect, type SelectionMode } from './GlassFieldMultiSelect';
import { GlassValueChip } from './GlassValueChip';

interface GlassFieldTagPickerProps {
  columns: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  onRemove: (item: string) => void;
  onClear: () => void;
  open: boolean;
  onToggle: () => void;
  placeholder?: string;
  columnTypes?: Record<string, string>;
  maxHeight?: string;
  selectionMode?: SelectionMode;
  variant?: 'flat' | 'glass';
  itemExtras?: (column: string) => ReactNode;
  columnLabel?: (column: string) => string;
  className?: string;
  tagClassName?: string;
  listClassName?: string;
}

export function GlassFieldTagPicker({
  columns,
  selected,
  onChange,
  onRemove,
  onClear,
  open,
  onToggle,
  placeholder,
  columnTypes,
  maxHeight = '160px',
  selectionMode = 'multi',
  variant = 'glass',
  itemExtras,
  columnLabel,
  className = '',
  tagClassName = '',
  listClassName = '',
}: GlassFieldTagPickerProps) {
  const tr = useFormTranslation('fieldPicker');
  // Selected values absent from `columns` stay visible with a missing marker —
  // the same two states as the list: pending inference vs not found.
  const missingValues = useMemo(
    () => new Set(selected.filter((item) => !columns.includes(item))),
    [columns, selected]
  );
  const missingTitle = columns.length === 0 ? tr('fieldPendingInference') : tr('fieldNotFound');

  return (
    <div className={`grid min-w-0 gap-0 ${className}`}>
      <div
        className={`flex h-8 min-h-8 w-full min-w-0 max-w-full items-center overflow-hidden rounded-md border border-border-muted bg-surface ${
          open ? 'rounded-b-none' : ''
        } ${tagClassName}`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center self-center rounded text-text-muted outline-none transition-colors hover:bg-error/10 hover:text-error focus-visible:ring-2 focus-visible:ring-accent/30"
            title={tr('clearAll')}
            aria-label={tr('clearAll')}
          >
            <Trash2 className="h-3 w-3" />
          </button>

          {selected.length === 0 && placeholder && (
            <span className="flex-shrink-0 whitespace-nowrap text-[12px] italic text-text-muted">
              {placeholder}
            </span>
          )}

          <div className="scrollbar-hover flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            {selected.map((item, index) => (
              <GlassValueChip
                key={`${item}-${index}`}
                label={item}
                missing={missingValues.has(item)}
                missingTitle={missingTitle}
                onRemove={() => onRemove(item)}
                removeAriaLabel={tr('removeField')}
              />
            ))}
          </div>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onToggle}
            className="flex w-8 flex-shrink-0 items-center justify-center self-stretch rounded-r-md border-l border-border-muted text-text-muted outline-none transition-colors hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30"
            aria-label={tr('selectField')}
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>
      {open && (
        <GlassFieldMultiSelect
          columns={columns}
          selected={selected}
          onChange={onChange}
          columnTypes={columnTypes}
          maxHeight={maxHeight}
          selectionMode={selectionMode}
          variant={variant}
          itemExtras={itemExtras}
          columnLabel={columnLabel}
          className={`-mt-px rounded-t-none ${listClassName}`}
        />
      )}
    </div>
  );
}
