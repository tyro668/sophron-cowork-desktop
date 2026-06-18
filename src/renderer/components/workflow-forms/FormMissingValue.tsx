import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, X } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassColumnSelector } from './shared/GlassColumnSelector';
import { GlassListEditor } from './shared/GlassListEditor';
import {
  isNumericDataFieldType,
  isTemporalDataFieldType,
  normalizeDataFieldType,
} from '../../../shared/data-field-types';

const SELECT_CLASS =
  'h-7 rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent';

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
  if (!colType) return BASE_METHODS;
  const type = normalizeDataFieldType(colType);
  if (isNumericDataFieldType(type))
    return [...BASE_METHODS, ...ORDERED_METHODS, ...STATISTICAL_METHODS];
  if (isTemporalDataFieldType(type)) return [...BASE_METHODS, ...ORDERED_METHODS];
  return BASE_METHODS;
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

type TabMode = 'row' | 'column';

export default function FormMissingValue({
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

  const tabMode: TabMode =
    strategy === 'drop_empty_rows' || strategy === 'drop_rows_by_nulls' ? 'row' : 'column';
  const rowSubMode = strategy === 'drop_empty_rows' ? 'all' : 'any';

  // Row mode combobox state
  const [showFieldPicker, setShowFieldPicker] = useState(false);
  const removingRef = useRef(false);

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

  const handleRowsColumnsChange = useCallback(
    (next: string[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        columns: next.length > 0 ? next : undefined,
      }));
    },
    [updateConfig]
  );

  const removeRowColumn = useCallback(
    (col: string) => {
      if (removingRef.current) return;
      removingRef.current = true;
      updateConfig((cfg) => {
        const next = ((cfg.columns as string[]) ?? []).filter((c) => c !== col);
        return {
          ...cfg,
          columns: next.length > 0 ? next : undefined,
        };
      });
      requestAnimationFrame(() => {
        removingRef.current = false;
      });
    },
    [updateConfig]
  );

  return (
    <div className="grid content-start gap-2.5">
      {/* Tab toggle */}
      <div className="flex h-8 rounded-md border border-border-muted bg-background/42 p-0.5">
        {(
          [
            { value: 'row' as const, label: tr('rowProcess', '按行处理') },
            { value: 'column' as const, label: tr('colProcess', '按列处理') },
          ] as const
        ).map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => switchTab(t.value)}
            className={`flex-1 rounded text-[11px] font-medium transition-all ${
              tabMode === t.value
                ? 'bg-background/70 text-accent shadow-soft'
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
          <div className="grid gap-2.5">
            {/* Sub-mode toggle */}
            <div className="flex h-8 rounded-md border border-border-muted bg-background/42 p-0.5">
              {(
                [
                  { value: 'all' as const, label: tr('allNull', '全部为空') },
                  { value: 'any' as const, label: tr('anyNull', '任一为空') },
                ] as const
              ).map((s) => (
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
                      ? 'bg-background/70 text-accent shadow-soft'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {rowSubMode === 'all' ? (
              <div className="rounded-lg border border-border-muted bg-background/42 px-3 py-3 text-center text-[12px] text-text-secondary">
                {tr('dropAllHint', '所有字段均为空 (null) 的行将被删除。')}
              </div>
            ) : (
              <>
                {/* Combobox for column selection */}
                <label className="grid gap-1">
                  <span className="text-[11px] font-medium text-text-secondary">
                    {tr('missingColumns', '判断字段')}
                  </span>
                  <div className="flex min-h-8 rounded-md border border-border-muted bg-background/42 focus-within:border-accent">
                    <div className="flex flex-1 flex-wrap items-center gap-1 px-1.5 py-1">
                      {rowColumns.map((col) => (
                        <span
                          key={col}
                          className="inline-flex items-center gap-0.5 rounded bg-surface-active/80 px-1.5 py-0.5 text-[11px] text-text-primary"
                        >
                          {col}
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              removeRowColumn(col);
                            }}
                            className="ml-0.5 flex-shrink-0 rounded-full p-0.5 hover:bg-surface-hover transition-colors"
                          >
                            <X className="h-2.5 w-2.5 text-text-muted" />
                          </button>
                        </span>
                      ))}
                      <input
                        type="text"
                        readOnly
                        placeholder={
                          rowColumns.length === 0
                            ? tr('missingSelectPlaceholder', '选择判断字段...')
                            : ''
                        }
                        className="h-5 min-w-[60px] flex-1 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted"
                      />
                    </div>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowFieldPicker((v) => !v);
                      }}
                      className="flex w-7 items-center justify-center border-l border-border-muted text-text-muted hover:text-text-secondary transition-colors rounded-r-md"
                    >
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${showFieldPicker ? 'rotate-180' : ''}`}
                      />
                    </button>
                  </div>
                </label>

                {/* Dropdown */}
                {showFieldPicker && (
                  <GlassColumnSelector
                    columns={fieldCompletions}
                    selected={rowColumns}
                    onChange={handleRowsColumnsChange}
                    maxHeight="200px"
                  />
                )}

                <p className="text-[10px] text-text-muted">
                  {tr('dropRowsHint', '任一勾选字段为空即删除该行。')}
                </p>
              </>
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
              const needsValue =
                effectiveMethod === 'nullify_values' || effectiveMethod === 'literal_fill';

              return (
                <div className="flex items-center gap-1.5">
                  {/* Column select */}
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
                      {tr('selectField', '选择字段')}
                    </option>
                    {fieldCompletions.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>

                  {/* Method select */}
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
                        {t(`ruleMethods.${m.value}`, { defaultValue: m.label })}
                      </option>
                    ))}
                  </select>

                  {/* Value input */}
                  {needsValue && (
                    <input
                      type="text"
                      value={
                        effectiveMethod === 'nullify_values'
                          ? (item.values ?? []).join(', ')
                          : String(item.value ?? '')
                      }
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (effectiveMethod === 'nullify_values') {
                          const vals = raw
                            .split(',')
                            .map((v) => v.trim().replace(/^"|"$/g, ''))
                            .filter(Boolean);
                          onChange({ ...item, values: vals.length > 0 ? vals : undefined });
                        } else {
                          onChange({ ...item, value: raw });
                        }
                      }}
                      placeholder={
                        effectiveMethod === 'nullify_values'
                          ? tr('missingSpecialValuesPlaceholder', '特殊值，逗号分隔。如 "", N/A, -')
                          : tr('missingFillPlaceholder', '填充值，如 UNKNOWN 或 0')
                      }
                      className="h-7 flex-1 min-w-0 rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
                    />
                  )}
                </div>
              );
            }}
            createDefault={createDefault}
            onChange={handleRulesChange}
            addLabel={tr('missingAddRule', '添加规则')}
            emptyText={tr('missingNoRules', '暂无处理规则')}
          />
          <p className="mt-2 text-[10px] leading-relaxed text-text-muted">
            {tr('missingRulesHint', '规则按顺序执行。均值/中位数/众数仅适用于数值字段。')}
          </p>
        </GlassFormSection>
      )}
    </div>
  );
}
