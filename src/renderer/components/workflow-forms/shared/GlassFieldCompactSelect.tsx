import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useFormTranslation } from '../../../hooks/useFormTranslation';

import { Search } from 'lucide-react';
import { useDataFieldTypeLabel } from '../../../hooks/useDataFieldTypeLabel';
import { DataTypeIcon } from './DataTypeIcon';

export interface GlassFieldCompactSelectProps {
  columns: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  columnTypes?: Record<string, string>;
  maxHeight?: string;
  itemExtras?: (column: string) => ReactNode;
  columnLabel?: (column: string) => string;
}

export const GlassFieldCompactSelect = memo(function GlassFieldCompactSelect({
  columns,
  selected,
  onChange,
  columnTypes,
  maxHeight = '160px',
  itemExtras,
  columnLabel,
}: GlassFieldCompactSelectProps) {
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
  }, [columns, columnTypes, dataTypeLabel, search]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selected.includes(c));
  const someFilteredSelected = filtered.some((c) => selected.includes(c));
  const selectAllIndeterminate = someFilteredSelected && !allFilteredSelected;

  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectAllIndeterminate;
    }
  }, [selectAllIndeterminate]);

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
    if (selected.includes(col)) {
      onChange(selected.filter((c) => c !== col));
    } else {
      onChange([...selected, col]);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex min-h-9 items-center gap-2 rounded-md border border-border-muted bg-background/60 px-2.5 py-1">
        <Search className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tr('searchField')}
          className="h-7 min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted"
        />
        <label
          className="flex shrink-0 cursor-pointer items-center gap-1 text-[12px] text-text-secondary font-medium"
          onMouseDown={(e) => {
            e.preventDefault();
            lockScrollTop();
          }}
        >
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={allFilteredSelected}
            onChange={toggleAll}
            className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
          />
          {tr('selectAll')}
        </label>
      </div>

      <div
        ref={listRef}
        className="scrollbar-hover overflow-y-auto flex-1 min-h-0"
        style={{ maxHeight }}
      >
        {filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-[12px] text-text-muted">
            {search ? tr('noMatch') : tr('noFields')}
          </div>
        ) : (
          filtered.map((col) => {
            const checked = selected.includes(col);
            return (
              <label
                key={col}
                className={`flex min-h-7 cursor-pointer items-center gap-2 px-2.5 py-1 text-[13px] transition-colors hover:bg-surface-hover ${
                  checked ? 'text-text-primary' : 'text-text-secondary'
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  lockScrollTop();
                }}
              >
                <input
                  type="checkbox"
                  name="glass-field-compact-select"
                  checked={checked}
                  onChange={() => selectItem(col)}
                  className="h-3.5 w-3.5 flex-shrink-0 accent-accent"
                />
                <DataTypeIcon type={columnTypes?.[col]} />
                <span className="flex-1 min-w-0 truncate">{columnLabel?.(col) ?? col}</span>
                {itemExtras?.(col)}
              </label>
            );
          })
        )}
      </div>
    </div>
  );
});
