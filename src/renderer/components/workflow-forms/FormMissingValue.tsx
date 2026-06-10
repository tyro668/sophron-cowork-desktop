import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassListEditor } from './shared/GlassListEditor';

const BASE_METHODS = [
  { value: 'skip', label: '不处理' },
  { value: 'nullify_values', label: '特殊值转空' },
  { value: 'literal_fill', label: '固定值填充' },
  { value: 'drop', label: '删除含缺失的行' },
];

const STATISTICAL_METHODS = [
  { value: 'mean_fill', label: '均值填充' },
  { value: 'median_fill', label: '中位数填充' },
  { value: 'mode_fill', label: '众数填充' },
];

const ORDERED_METHODS = [
  { value: 'forward_fill', label: '前向填充' },
  { value: 'backward_fill', label: '后向填充' },
];

function methodsForType(colType: string | undefined) {
  if (!colType) return BASE_METHODS; // unknown type: show base only
  const t = colType.toLowerCase();
  const isNumeric =
    t.includes('int') ||
    t.includes('float') ||
    t.includes('double') ||
    t.includes('decimal') ||
    t.includes('numeric') ||
    t.includes('real') ||
    t.includes('number');
  const isTemporal = t.includes('date') || t.includes('time') || t.includes('timestamp');

  if (isNumeric) return [...BASE_METHODS, ...ORDERED_METHODS, ...STATISTICAL_METHODS];
  if (isTemporal) return [...BASE_METHODS, ...ORDERED_METHODS];
  return BASE_METHODS; // string, boolean, etc.
}

interface MissingRule {
  column: string;
  method: string;
  values?: string[];
  value?: unknown;
}

function createDefault(): MissingRule {
  return { column: '', method: 'literal_fill', value: '' };
}

const SELECT_CLASS =
  'h-7 rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent';

type TabMode = 'row' | 'column';

export default function FormMissingValue({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
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

  const strategy = (node.config.strategy as string) ?? 'by_column';
  const rules: MissingRule[] = (node.config.rules as MissingRule[]) ?? [];
  const rowColumns: string[] = (node.config.columns as string[]) ?? [];
  const [search, setSearch] = useState('');

  // Which tab is active
  const tabMode: TabMode =
    strategy === 'drop_empty_rows' || strategy === 'drop_rows_by_nulls' ? 'row' : 'column';

  // Row sub-mode
  const rowSubMode = strategy === 'drop_empty_rows' ? 'all' : 'any';

  // Column types
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

  const filteredFields = useMemo(() => {
    if (!search.trim()) return fieldCompletions;
    const lower = search.toLowerCase();
    return fieldCompletions.filter((c) => c.toLowerCase().includes(lower));
  }, [fieldCompletions, search]);

  function switchTab(tab: TabMode) {
    if (tab === 'column') {
      updateConfig((cfg) => ({
        ...cfg,
        strategy: 'by_column',
        condition: undefined,
        columns: undefined,
      }));
    } else {
      updateConfig((cfg) => ({
        ...cfg,
        strategy: 'drop_rows_by_nulls',
        condition: 'any_null',
        rules: undefined,
      }));
    }
  }

  function handleRulesChange(items: MissingRule[]) {
    updateConfig((cfg) => ({ ...cfg, rules: items.length > 0 ? items : undefined }));
  }

  return (
    <div className="grid content-start gap-2.5">
      {/* Tab toggle */}
      <div className="flex h-7 rounded-md border border-border-muted bg-background/42 p-0.5">
        {[
          { value: 'row' as const, label: '按行处理' },
          { value: 'column' as const, label: '按列处理' },
        ].map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => switchTab(t.value)}
            className={`flex-1 rounded text-[11px] font-medium transition-all ${
              tabMode === t.value
                ? 'bg-accent/10 text-accent shadow-soft'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Row mode */}
      {tabMode === 'row' && (
        <GlassFormSection>
          <div className="grid gap-2">
            <div className="flex h-7 rounded-md border border-border-muted bg-background/42 p-0.5">
              {[
                { value: 'all' as const, label: '全部为空' },
                { value: 'any' as const, label: '任一为空' },
              ].map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() =>
                    updateConfig((cfg) => ({
                      ...cfg,
                      strategy: s.value === 'all' ? 'drop_empty_rows' : 'drop_rows_by_nulls',
                      condition: s.value === 'all' ? 'all_null' : 'any_null',
                      columns: s.value === 'all' ? undefined : cfg.columns,
                    }))
                  }
                  className={`flex-1 rounded text-[11px] font-medium transition-all ${
                    rowSubMode === s.value
                      ? 'bg-accent/10 text-accent shadow-soft'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {rowSubMode === 'all' ? (
              <div className="rounded-lg border border-border-muted bg-background/42 px-3 py-2 text-[12px] text-text-secondary text-center">
                所有字段均为空 (null) 的行将被删除。
              </div>
            ) : (
              <div>
                <div className="relative mb-2">
                  <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜索字段..."
                    className="h-7 w-full rounded-md border border-border-muted bg-background/42 pl-7 pr-2 text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-border-muted bg-background/42 p-1.5">
                  {filteredFields.length === 0 ? (
                    <div className="py-4 text-center text-[12px] text-text-muted">
                      {search ? '无匹配字段' : '暂无可用字段'}
                    </div>
                  ) : (
                    filteredFields.map((col) => (
                      <label
                        key={col}
                        className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px] text-text-secondary hover:bg-surface-hover"
                      >
                        <input
                          type="checkbox"
                          checked={rowColumns.includes(col)}
                          onChange={() => {
                            const next = rowColumns.includes(col)
                              ? rowColumns.filter((c) => c !== col)
                              : [...rowColumns, col];
                            updateConfig((cfg) => ({
                              ...cfg,
                              columns: next.length > 0 ? next : undefined,
                            }));
                          }}
                          className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
                        />
                        {col}
                        {columnTypes[col] && (
                          <span className="ml-auto text-[10px] text-text-muted">
                            {columnTypes[col]}
                          </span>
                        )}
                      </label>
                    ))
                  )}
                </div>
                <p className="mt-1 text-[10px] text-text-muted">任一勾选字段为空即删除该行。</p>
              </div>
            )}
          </div>
        </GlassFormSection>
      )}

      {/* Column mode */}
      {tabMode === 'column' && (
        <GlassFormSection>
          <GlassListEditor
            items={rules}
            renderRow={(item, _index, onChange) => {
              const fieldSelected = !!item.column;
              const colType = item.column ? columnTypes[item.column] : undefined;
              const availableMethods = methodsForType(colType);
              const validMethodValues = availableMethods.map((m) => m.value);
              const effectiveMethod = validMethodValues.includes(item.method)
                ? item.method
                : (availableMethods[0]?.value ?? 'skip');
              const needsValue = item.method === 'nullify_values' || item.method === 'literal_fill';

              return (
                <div className="flex items-center gap-1.5">
                  <select
                    value={item.column}
                    onChange={(e) => {
                      const col = e.target.value;
                      const newType = columnTypes[col];
                      const methods = methodsForType(newType);
                      const methodOk = methods.some((m) => m.value === item.method);
                      onChange({
                        ...item,
                        column: col,
                        method: methodOk ? item.method : (methods[0]?.value ?? 'skip'),
                      });
                    }}
                    className={SELECT_CLASS + ' flex-1 min-w-0'}
                  >
                    <option value="" disabled>
                      选择字段
                    </option>
                    {fieldCompletions.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                  <select
                    value={effectiveMethod}
                    disabled={!fieldSelected}
                    onChange={(e) => {
                      const m = e.target.value;
                      onChange({
                        ...item,
                        method: m,
                        values: m === 'nullify_values' ? (item.values ?? []) : undefined,
                        value: m === 'literal_fill' ? (item.value ?? '') : undefined,
                      });
                    }}
                    className={
                      SELECT_CLASS +
                      ' w-28 shrink-0 disabled:cursor-not-allowed disabled:opacity-50'
                    }
                  >
                    {availableMethods.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  {needsValue && (
                    <GlassFormTextInput
                      value={
                        item.method === 'nullify_values'
                          ? (item.values ?? []).join(', ')
                          : String(item.value ?? '')
                      }
                      onChange={(value) => {
                        if (item.method === 'nullify_values') {
                          const vals = value
                            .split(',')
                            .map((v) => v.trim().replace(/^"|"$/g, ''))
                            .filter(Boolean);
                          onChange({ ...item, values: vals.length > 0 ? vals : undefined });
                        } else {
                          onChange({ ...item, value: value || undefined });
                        }
                      }}
                      placeholder={
                        item.method === 'nullify_values'
                          ? '特殊值，逗号分隔。如 "", N/A, -'
                          : '填充值，如 UNKNOWN 或 0'
                      }
                      className="h-7 flex-1 min-w-0"
                    />
                  )}
                </div>
              );
            }}
            createDefault={createDefault}
            onChange={handleRulesChange}
            addLabel="添加规则"
            emptyText="暂无处理规则"
          />
          <p className="mt-2 text-[10px] leading-relaxed text-text-muted">
            规则按顺序执行。均值/中位数/众数仅适用于数值字段。
          </p>
        </GlassFormSection>
      )}
    </div>
  );
}
