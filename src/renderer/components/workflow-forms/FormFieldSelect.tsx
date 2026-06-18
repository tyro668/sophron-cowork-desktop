import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { DATA_FIELD_TYPE_LABELS, normalizeDataFieldType } from '../../../shared/data-field-types';

export default function FormFieldSelect({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!taskId || !sourceNode?.id) return;
    const api = window.electronAPI?.data;
    if (!api?.getWorkflowNodeColumnTypes) return;
    api
      .getWorkflowNodeColumnTypes({
        taskId,
        nodeId: sourceNode.id,
        nodeType: sourceNode.type as never,
        nodeConfig: (sourceNode.config ?? {}) as Record<string, unknown>,
      })
      .then((types) => {
        const map: Record<string, string> = {};
        for (const t of types) map[t.name] = t.type;
        setColumnTypes(map);
      })
      .catch(() => setColumnTypes({}));
  }, [taskId, sourceNode?.id, sourceNode?.type, sourceNode?.config]);

  const typeLabel = useCallback(
    (col: string) => {
      const raw = columnTypes[col];
      if (!raw) return '';
      return DATA_FIELD_TYPE_LABELS[normalizeDataFieldType(raw)] ?? '';
    },
    [columnTypes]
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
  const savedScrollRef = useRef(0);

  // Restore scroll when React remounts the list DOM element.
  const setListRef = useCallback((el: HTMLDivElement | null) => {
    listRef.current = el;
    if (el && savedScrollRef.current > 0 && el.scrollHeight > savedScrollRef.current) {
      el.scrollTop = savedScrollRef.current;
    }
  }, []);

  const commitColumns = useCallback(
    (next: string[]) => {
      savedScrollRef.current = listRef.current?.scrollTop ?? 0;
      updateConfig((cfg) => ({
        ...cfg,
        mode: 'include',
        columns: next.length > 0 ? next : undefined,
      }));
    },
    [updateConfig]
  );

  // Restore scroll after DOM reconciliation. Never clears savedScrollRef —
  // React's multi-pass commit briefly empties then refills the list DOM,
  // so saved stays alive across all passes. Only commitColumns overwrites it.
  useLayoutEffect(() => {
    const el = listRef.current;
    const saved = savedScrollRef.current;
    if (!el || saved <= 0 || el.scrollHeight <= saved) return;
    el.scrollTop = saved;
  });

  const filtered = useMemo(() => {
    const lower = search.toLowerCase().trim();
    if (!lower) return fieldCompletions;
    return fieldCompletions.filter((c) => {
      if (c.toLowerCase().includes(lower)) return true;
      const raw = columnTypes[c];
      if (!raw) return false;
      const label = DATA_FIELD_TYPE_LABELS[normalizeDataFieldType(raw)] ?? '';
      return label.includes(lower);
    });
  }, [fieldCompletions, search, columnTypes]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => columns.includes(c));

  const toggleAll = useCallback(() => {
    if (filtered.length === 0) return;
    if (allFilteredSelected) {
      const filteredSet = new Set(filtered);
      commitColumns(columns.filter((c) => !filteredSet.has(c)));
    } else {
      const toAdd = filtered.filter((c) => !columns.includes(c));
      commitColumns([...columns, ...toAdd]);
    }
  }, [filtered, allFilteredSelected, columns, commitColumns]);

  const toggleColumn = useCallback(
    (col: string) => {
      if (columns.includes(col)) {
        commitColumns(columns.filter((c) => c !== col));
      } else {
        commitColumns([...columns, col]);
      }
    },
    [columns, commitColumns]
  );

  const removeColumn = useCallback(
    (col: string) => {
      commitColumns(columns.filter((c) => c !== col));
    },
    [columns, commitColumns]
  );

  const clearAll = useCallback(() => {
    commitColumns([]);
  }, [commitColumns]);

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection>
        {/* Title bar */}
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-text-muted">
            {tr('fieldSelectCount', '已选 {{n}}/{{total}} 个字段')
              .replace('{{n}}', String(columns.length))
              .replace('{{total}}', String(fieldCompletions.length))}
          </span>
          <div className="flex items-center gap-2">
            {columns.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="text-[12px] text-text-muted hover:text-error transition-colors"
              >
                {tr('clearAll', '清空')}
              </button>
            )}
          </div>
        </div>

        {/* Dual-pane layout */}
        <div className="grid grid-cols-2 gap-3 min-h-0">
          {/* Left: field library */}
          <div className="flex min-h-0 flex-col rounded-lg border border-border-muted bg-background/42">
            {/* Search */}
            <div className="flex items-center gap-1.5 border-b border-border-subtle px-2 py-1.5">
              <Search className="h-3 w-3 flex-shrink-0 text-text-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tr('searchField', '搜索字段...')}
                className="h-6 w-full bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted"
              />
            </div>

            {/* Select all toggle */}
            <label
              className="flex cursor-pointer items-center gap-1.5 border-b border-border-subtle px-2.5 py-1.5 text-[12px] text-text-muted hover:text-text-secondary"
              onMouseDown={(e) => e.preventDefault()}
            >
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={toggleAll}
                className="h-4 w-4 rounded border-border-muted accent-accent"
              />
              {allFilteredSelected ? tr('deselectAll', '取消全选') : tr('selectAll', '全选')}
            </label>

            {/* Field list — fixed height so scroll position is independent of right panel */}
            <div ref={setListRef} className="overflow-y-auto" style={{ height: '280px' }}>
              {filtered.length === 0 ? (
                <div className="px-3 py-6 text-center text-[12px] text-text-muted">
                  {search ? tr('noMatch', '无匹配字段') : tr('noFields', '暂无可用字段')}
                </div>
              ) : (
                filtered.map((col) => (
                  <label
                    key={col}
                    className={`flex cursor-pointer items-center gap-2 px-2.5 py-[6px] text-[13px] transition-colors hover:bg-surface-hover ${
                      columns.includes(col) ? 'text-text-primary' : 'text-text-secondary'
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={columns.includes(col)}
                      onChange={() => toggleColumn(col)}
                      className="h-4 w-4 rounded border-border-muted accent-accent"
                    />
                    <span className="flex-1 min-w-0 truncate">{col}</span>
                    <span className="flex-shrink-0 text-[11px] text-text-muted tabular-nums">
                      {typeLabel(col)}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Right: selected fields */}
          <div className="flex min-h-0 flex-col rounded-lg border border-border-subtle bg-background/24">
            <div className="flex items-center justify-between border-b border-border-subtle px-2.5 py-1.5">
              <span className="text-[12px] font-medium text-text-secondary">
                {tr('selectedFields', '已选字段')}
              </span>
              <span className="text-[10px] text-text-muted">{columns.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-1.5">
              {columns.length === 0 ? (
                <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                  {tr('noFieldsSelected', '暂未选择字段')}
                </div>
              ) : (
                <div className="flex flex-wrap content-start gap-1">
                  {columns.map((col) => (
                    <span
                      key={col}
                      className="inline-flex items-center gap-0.5 rounded bg-accent/10 px-1.5 py-0.5 text-[12px] font-medium text-accent"
                    >
                      {col}
                      <button
                        type="button"
                        onClick={() => removeColumn(col)}
                        className="ml-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full hover:bg-accent/20"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </GlassFormSection>
    </div>
  );
}
