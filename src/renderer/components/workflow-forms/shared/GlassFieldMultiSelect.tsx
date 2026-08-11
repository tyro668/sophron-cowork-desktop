import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useFormTranslation } from '../../../hooks/useFormTranslation';

import { Search } from 'lucide-react';
import { useDataFieldTypeLabel } from '../../../hooks/useDataFieldTypeLabel';

export type SelectionMode = 'single' | 'multi';

export interface GlassFieldMultiSelectProps {
  columns: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  columnTypes?: Record<string, string>;
  maxHeight?: string;
  selectionMode?: SelectionMode;
  variant?: 'flat' | 'glass';
  itemExtras?: (column: string) => ReactNode;
  columnLabel?: (column: string) => string;
}

export const GlassFieldMultiSelect = memo(function GlassFieldMultiSelect({
  columns,
  selected,
  onChange,
  columnTypes,
  maxHeight = '160px',
  selectionMode = 'multi',
  variant = 'flat',
  itemExtras,
  columnLabel,
}: GlassFieldMultiSelectProps) {
  const tr = useFormTranslation();
  const dataTypeLabel = useDataFieldTypeLabel();

  const [search, setSearch] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);
  const restoreFramesRef = useRef(0);

  const lockScrollTop = useCallback(() => {
    const listEl = listRef.current;
    if (!listEl) return;
    pendingScrollTopRef.current = listEl.scrollTop;
    restoreFramesRef.current = 6;
  }, []);

  const restoreScrollTop = useCallback(() => {
    const listEl = listRef.current;
    const pendingScrollTop = pendingScrollTopRef.current;
    if (!listEl || pendingScrollTop === null) return;

    const maxScrollTop = Math.max(0, listEl.scrollHeight - listEl.clientHeight);
    const target = Math.max(0, Math.min(pendingScrollTop, maxScrollTop));
    if (listEl.scrollTop !== target) {
      listEl.scrollTop = target;
    }

    restoreFramesRef.current -= 1;
    if (restoreFramesRef.current <= 0) {
      pendingScrollTopRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    if (restoreFramesRef.current > 0) {
      restoreScrollTop();
    }
  });

  useEffect(() => {
    if (restoreFramesRef.current > 0) {
      restoreScrollTop();
    }
  });

  useEffect(() => {
    pendingScrollTopRef.current = null;
    restoreFramesRef.current = 0;
  }, [search]);

  const filtered = useMemo(() => {
    const lower = search.toLowerCase().trim();
    if (!lower) return columns;
    return columns.filter((c) => {
      if (c.toLowerCase().includes(lower)) return true;
      const type = columnTypes?.[c];
      if (!type) return false;
      if (type.toLowerCase().includes(lower)) return true;
      return dataTypeLabel(type).toLowerCase().includes(lower);
    });
  }, [columns, columnTypes, search]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selected.includes(c));

  const isGlass = variant === 'glass';

  function toggleAll() {
    if (filtered.length === 0) return;

    if (allFilteredSelected) {
      const filteredSet = new Set(filtered);
      onChange(selected.filter((c) => !filteredSet.has(c)));
    } else {
      const toAdd = filtered.filter((c) => !selected.includes(c));
      onChange([...selected, ...toAdd]);
    }
  }

  function selectItem(col: string) {
    lockScrollTop();
    if (selectionMode === 'single') {
      onChange([col]);
    } else {
      if (selected.includes(col)) {
        onChange(selected.filter((c) => c !== col));
      } else {
        onChange([...selected, col]);
      }
    }
  }

  return (
    <div
      className={`flex min-h-0 flex-col rounded-lg border ${
        isGlass
          ? 'border-border-subtle bg-[var(--glass-card-strong)] shadow-elevated backdrop-blur-xl'
          : 'border-border-muted bg-background/60'
      }`}
    >
      <div
        className={`flex items-center border-b border-border-subtle px-2.5 py-1 ${
          isGlass ? 'gap-1.5' : 'gap-2'
        }`}
      >
        <Search
          className={`flex-shrink-0 text-text-muted ${isGlass ? 'h-3 w-3' : 'h-3.5 w-3.5'}`}
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tr('searchField')}
          className={`${isGlass ? 'h-6' : 'h-5'} min-w-0 flex-1 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted`}
        />
        {selectionMode === 'multi' && (
          <label
            className={`flex shrink-0 cursor-pointer items-center gap-1 ${
              isGlass
                ? 'text-[11px] text-text-muted hover:text-text-secondary'
                : 'text-[12px] text-text-secondary font-medium'
            }`}
            onMouseDown={(e) => {
              e.preventDefault();
              lockScrollTop();
            }}
          >
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleAll}
              className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
            />
            {allFilteredSelected ? tr('deselectAll') : tr('selectAll')}
          </label>
        )}
      </div>

      <div
        ref={listRef}
        className={`overflow-y-auto [overflow-anchor:none] ${isGlass ? '' : 'flex-1 min-h-0'}`}
        style={{ maxHeight }}
      >
        {filtered.length === 0 ? (
          <div
            className={`px-3 text-center text-[12px] text-text-muted ${isGlass ? 'py-4' : 'py-8'}`}
          >
            {search ? tr('noMatch') : tr('noFields')}
          </div>
        ) : (
          filtered.map((col) => {
            const checked = selected.includes(col);
            return (
              <label
                key={col}
                className={`flex cursor-pointer items-center gap-2 px-2.5 transition-colors hover:bg-surface-hover ${
                  isGlass ? 'py-1.5 text-[12px]' : 'py-[4px] text-[13px]'
                } ${checked ? 'text-text-primary' : 'text-text-secondary'}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  lockScrollTop();
                }}
              >
                <input
                  type={selectionMode === 'single' ? 'radio' : 'checkbox'}
                  name="glass-field-select"
                  checked={checked}
                  onChange={() => selectItem(col)}
                  className="h-3.5 w-3.5 flex-shrink-0 accent-accent"
                />
                <span className="flex-1 min-w-0 truncate">{columnLabel?.(col) ?? col}</span>
                {itemExtras?.(col)}
                {columnTypes?.[col] && (
                  <span
                    className={`flex-shrink-0 text-[11px] text-text-muted tabular-nums ${
                      isGlass ? '' : 'w-14 text-right'
                    }`}
                  >
                    {dataTypeLabel(columnTypes[col])}
                  </span>
                )}
              </label>
            );
          })
        )}
      </div>
    </div>
  );
});
