import type { ReactNode } from 'react';
import { ChevronDown, Trash2, X } from 'lucide-react';
import { useFormTranslation } from '../../../hooks/useFormTranslation';
import { GlassFieldMultiSelect, type SelectionMode } from './GlassFieldMultiSelect';

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
  const tr = useFormTranslation();

  return (
    <div className={`grid min-w-0 gap-0 ${className}`}>
      <div
        className={`flex h-9 min-h-9 w-full min-w-0 max-w-full items-center overflow-hidden rounded-md border border-border-muted bg-background/42 ${
          open ? 'rounded-b-none' : ''
        } ${tagClassName}`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center self-center rounded text-text-muted outline-none transition-colors hover:bg-error/10 hover:text-error focus-visible:ring-2 focus-visible:ring-accent/30"
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

          <div className="scrollbar-hover flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {selected.map((item, index) => (
              <span
                key={`${item}-${index}`}
                className="inline-flex min-h-6 max-w-[180px] shrink-0 items-center gap-0.5 rounded bg-accent/10 px-1 py-0.5 text-[12px] font-medium text-accent"
              >
                <span className="truncate">{item}</span>
                <button
                  type="button"
                  onClick={() => onRemove(item)}
                  className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full outline-none hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-accent/30"
                  aria-label={tr('removeField')}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
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
