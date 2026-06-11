import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';

export default function FormFieldSelect({
  node,
  fieldCompletions,
  onNodeChange,
}: OperatorFormProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) => t(`formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

  const updateConfig = useCallback(
    (updater: (config: Record<string, unknown>) => Record<string, unknown>) => {
      onNodeChange((current) => ({
        ...current,
        config: updater(current.config),
        updatedAt: Date.now(),
      }));
    },
    [onNodeChange]
  );

  const columns: string[] = (node.config.columns as string[]) ?? [];
  const [search, setSearch] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);

  const lockScrollTop = useCallback(() => {
    pendingScrollTopRef.current = listRef.current?.scrollTop ?? 0;
  }, []);

  const commitSelection = useCallback(
    (nextColumns: string[]) => {
      lockScrollTop();
      updateConfig((cfg) => ({
        ...cfg,
        mode: 'include',
        columns: nextColumns.length > 0 ? nextColumns : undefined,
      }));
    },
    [lockScrollTop, updateConfig]
  );

  useLayoutEffect(() => {
    const listEl = listRef.current;
    const pendingScrollTop = pendingScrollTopRef.current;
    if (!listEl || pendingScrollTop === null) return;

    listEl.scrollTop = pendingScrollTop;
    pendingScrollTopRef.current = null;
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return fieldCompletions;
    const lower = search.toLowerCase();
    return fieldCompletions.filter((c) => c.toLowerCase().includes(lower));
  }, [fieldCompletions, search]);

  const allSelected = filtered.length > 0 && filtered.every((c) => columns.includes(c));
  const noneSelected = filtered.length === 0 || !filtered.some((c) => columns.includes(c));

  function toggleAll() {
    if (filtered.length === 0) return;

    if (allSelected) {
      const filteredSet = new Set(filtered);
      commitSelection(columns.filter((c) => !filteredSet.has(c)));
    } else {
      commitSelection([...new Set([...columns, ...filtered])]);
    }
  }

  function toggleColumn(col: string) {
    const next = columns.includes(col) ? columns.filter((c) => c !== col) : [...columns, col];
    commitSelection(next);
  }

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr('searchField', '搜索字段...')}
            className="h-7 w-full rounded-md border border-border-muted bg-background/42 pl-7 pr-2 text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-text-muted hover:text-text-secondary"
            >
              {tr('clear', '清除')}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 border-b border-border-subtle px-0.5 pb-1">
          <label
            className="flex cursor-pointer items-center gap-1.5 text-[11px] text-text-muted hover:text-text-secondary"
            onMouseDown={(e) => {
              e.preventDefault();
              lockScrollTop();
            }}
          >
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = !allSelected && !noneSelected;
              }}
              onChange={toggleAll}
              className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
            />
            {allSelected ? tr('deselectAll', '取消全选') : tr('selectAll', '全选')}
          </label>
          <span className="text-[10px] text-text-muted">
            {columns.length}/{fieldCompletions.length}
          </span>
        </div>

        <div ref={listRef} className="max-h-48 overflow-y-auto [overflow-anchor:none]">
          {filtered.length === 0 ? (
            <div className="py-4 text-center text-[12px] text-text-muted">
              {search ? tr('noMatch', '无匹配字段') : tr('noFields', '暂无可用字段')}
            </div>
          ) : (
            filtered.map((col) => (
              <label
                key={col}
                className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px] transition-colors hover:bg-surface-hover ${
                  columns.includes(col) ? 'text-text-primary' : 'text-text-secondary'
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  lockScrollTop();
                }}
              >
                <input
                  type="checkbox"
                  checked={columns.includes(col)}
                  onChange={() => toggleColumn(col)}
                  className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
                />
                {col}
              </label>
            ))
          )}
        </div>
      </GlassFormSection>
    </div>
  );
}
