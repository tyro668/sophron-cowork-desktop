import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { dataFieldTypeLabel } from '@/shared/data-field-types';

interface GlassColumnSelectorProps {
  columns: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  maxHeight?: string;
  columnTypes?: Record<string, string>;
}

export const GlassColumnSelector = memo(function GlassColumnSelector({
  columns,
  selected,
  onChange,
  maxHeight = '160px',
  columnTypes,
}: GlassColumnSelectorProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

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

  const commitSelection = useCallback(
    (nextSelected: string[]) => {
      lockScrollTop();
      onChange(nextSelected);
    },
    [lockScrollTop, onChange]
  );

  useLayoutEffect(() => {
    if (restoreFramesRef.current > 0) {
      restoreScrollTop();
    }
    // Intentionally run after every render to restore scroll synchronously before paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  useEffect(() => {
    if (restoreFramesRef.current > 0) {
      restoreScrollTop();
    }
    // Intentionally run after every render to catch any scroll reset after paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  // Searching changes the list contents; don't fight it with stale scroll positions.
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
      return dataFieldTypeLabel(type).toLowerCase().includes(lower);
    });
  }, [columns, columnTypes, search]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selected.includes(c));

  function toggleAll() {
    if (filtered.length === 0) return;

    if (allFilteredSelected) {
      const filteredSet = new Set(filtered);
      commitSelection(selected.filter((c) => !filteredSet.has(c)));
    } else {
      const toAdd = filtered.filter((c) => !selected.includes(c));
      commitSelection([...selected, ...toAdd]);
    }
  }

  function toggleColumn(col: string) {
    if (selected.includes(col)) {
      commitSelection(selected.filter((c) => c !== col));
    } else {
      commitSelection([...selected, col]);
    }
  }

  return (
    <div className="rounded-lg border border-border-subtle bg-[var(--glass-card-strong)] shadow-elevated backdrop-blur-xl">
      <div className="flex items-center gap-1.5 border-b border-border-subtle px-2 py-1">
        <Search className="h-3 w-3 flex-shrink-0 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tr('searchField', '搜索字段...')}
          className="h-6 min-w-0 flex-1 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted"
        />
        <label
          className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-text-muted hover:text-text-secondary"
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
          {allFilteredSelected ? tr('deselectAll', '取消全选') : tr('selectAll', '全选')}
        </label>
      </div>

      <div ref={listRef} className="overflow-y-auto [overflow-anchor:none]" style={{ maxHeight }}>
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-[12px] text-text-muted">
            {search ? tr('noMatch', '无匹配字段') : tr('noFields', '暂无可用字段')}
          </div>
        ) : (
          filtered.map((col) => (
            <label
              key={col}
              className={`flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[12px] transition-colors hover:bg-surface-hover ${
                selected.includes(col) ? 'text-text-primary' : 'text-text-secondary'
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                lockScrollTop();
              }}
            >
              <input
                type="checkbox"
                checked={selected.includes(col)}
                onChange={() => toggleColumn(col)}
                className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
              />
              <span className="flex-1 truncate">{col}</span>
              {columnTypes?.[col] && (
                <span className="flex-shrink-0 text-[11px] tabular-nums text-text-muted">
                  {dataFieldTypeLabel(columnTypes[col])}
                </span>
              )}
            </label>
          ))
        )}
      </div>
    </div>
  );
});
