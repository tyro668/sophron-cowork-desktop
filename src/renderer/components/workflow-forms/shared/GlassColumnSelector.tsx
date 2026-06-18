import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';

interface GlassColumnSelectorProps {
  columns: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  maxHeight?: string;
}

export function GlassColumnSelector({
  columns,
  selected,
  onChange,
  maxHeight = '160px',
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

  const lockScrollTop = useCallback(() => {
    pendingScrollTopRef.current = listRef.current?.scrollTop ?? 0;
  }, []);

  const commitSelection = useCallback(
    (nextSelected: string[]) => {
      lockScrollTop();
      onChange(nextSelected);
    },
    [lockScrollTop, onChange]
  );

  useLayoutEffect(() => {
    const listEl = listRef.current;
    const pendingScrollTop = pendingScrollTopRef.current;
    if (!listEl || pendingScrollTop === null) return;

    listEl.scrollTop = pendingScrollTop;
    pendingScrollTopRef.current = null;
  });

  const filtered = useMemo(() => {
    const lower = search.toLowerCase().trim();
    if (!lower) return columns;
    return columns.filter((c) => c.toLowerCase().includes(lower));
  }, [columns, search]);

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
    <div className="rounded-lg border border-border-muted bg-background/42">
      <div className="flex items-center gap-1.5 border-b border-border-subtle px-2 py-1">
        <Search className="h-3 w-3 flex-shrink-0 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tr('searchField', '搜索字段...')}
          className="h-6 w-full bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted"
        />
      </div>

      <div className="flex items-center gap-2 border-b border-border-subtle px-2.5 py-1.5">
        <label
          className="flex cursor-pointer items-center gap-1.5 text-[11px] text-text-muted hover:text-text-secondary"
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
        <span className="text-[10px] text-text-muted">
          {selected.length}/{columns.length}
        </span>
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
              {col}
            </label>
          ))
        )}
      </div>
    </div>
  );
}
