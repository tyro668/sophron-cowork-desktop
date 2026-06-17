import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Loader2, ChevronDown } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import {
  isNumericDataFieldType,
  isTemporalDataFieldType,
  normalizeDataFieldType,
} from '../../../shared/data-field-types';
import { buildFilterCondition, type FilterConditionRow } from './shared/filter-condition';

// ── Operator definitions ──────────────────────────────────────────────

type OpDef = { label: string; value: string };

const ALL_OPERATORS: OpDef[] = [
  { label: '', value: '=' },
  { label: '', value: '>' },
  { label: '', value: '<' },
  { label: '', value: '<=' },
  { label: '', value: '>=' },
  { label: '', value: '!=' },
  { label: '', value: 'between' },
];

const STRING_OPS: OpDef[] = [
  { label: '', value: '=' },
  { label: '', value: '!=' },
];

const BOOLEAN_OPS: OpDef[] = [{ label: '', value: '=' }];

const OP_LABEL_KEYS: Record<string, string> = {
  '=': 'filterOpEq',
  '>': 'filterOpGt',
  '<': 'filterOpLt',
  '<=': 'filterOpLte',
  '>=': 'filterOpGte',
  '!=': 'filterOpNeq',
  between: 'filterOpBetween',
};

function operatorsForType(colType: string | undefined): OpDef[] {
  if (!colType) return ALL_OPERATORS;
  const type = normalizeDataFieldType(colType);
  if (isNumericDataFieldType(type)) return ALL_OPERATORS;
  if (type === 'text') return STRING_OPS;
  if (isTemporalDataFieldType(type)) return ALL_OPERATORS;
  if (type === 'boolean') return BOOLEAN_OPS;
  return ALL_OPERATORS;
}

// ── Condition data types ──────────────────────────────────────────────

type Connective = FilterConditionRow['connective'];
type ConditionRow = FilterConditionRow;

const EMPTY_ROW: ConditionRow = { field: '', op: '=', val1: '', val2: '', connective: 'and' };

// ── Parse / Build ─────────────────────────────────────────────────────

function parseSingleCondition(expr: string): ConditionRow | null {
  const betweenMatch = expr.match(
    /^\s*\[([^\]]+)\]\s+between\s+(.+?)\s+(?:and|%%PH%%)\s+(.+?)\s*$/i
  );
  if (betweenMatch) {
    return {
      field: betweenMatch[1],
      op: 'between',
      val1: betweenMatch[2].replace(/^["']|["']$/g, '').trim(),
      val2: betweenMatch[3].replace(/^["']|["']$/g, '').trim(),
      connective: 'and',
    };
  }
  const cmpMatch = expr.match(/^\s*\[([^\]]+)\]\s*(>=?|<=?|!=?|=)\s*(.+?)\s*$/);
  if (cmpMatch) {
    return {
      field: cmpMatch[1],
      op: cmpMatch[2],
      val1: cmpMatch[3].replace(/^["']|["']$/g, '').trim(),
      val2: '',
      connective: 'and',
    };
  }
  return null;
}

function parseCondition(condition: string | undefined): ConditionRow[] {
  if (!condition) return [];
  const betweenPattern = /\[([^\]]+)\]\s+between\s+(.+?)\s+and\s+(.+?)(?=\s*(?:$|and\s|or\s))/gi;
  const placeholders: string[] = [];
  const protected_ = condition.replace(betweenPattern, (_m, field, v1, v2) => {
    const idx = placeholders.length;
    placeholders.push(`[${field}] between ${v1} %%PH%% ${v2}`);
    return `__BETWEEN_${idx}__`;
  });

  const tokens = protected_.split(/(\s+(?:and|or)\s+)/i);
  const rows: ConditionRow[] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const expr = tokens[i];
    if (!expr?.trim()) continue;
    const restored = expr.replace(/__BETWEEN_(\d+)__/g, (_m, idx) => {
      return placeholders[Number(idx)] ?? _m;
    });
    const row = parseSingleCondition(restored.trim());
    if (!row) continue;
    const connectiveToken = tokens[i - 1];
    row.connective = connectiveToken ? (connectiveToken.trim().toLowerCase() as Connective) : 'and';
    rows.push(row);
  }
  return rows;
}

function eqRows(a: ConditionRow[], b: ConditionRow[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (r, i) =>
      r.field === b[i].field &&
      r.op === b[i].op &&
      r.val1 === b[i].val1 &&
      r.val2 === b[i].val2 &&
      r.connective === b[i].connective
  );
}

// ── Shared styles ─────────────────────────────────────────────────────

const SELECT_BASE =
  'h-8 rounded-md border border-border-muted bg-background/42 pl-2 pr-6 text-[12px] text-text-secondary outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-40 appearance-none';

// ── Searchable dropdown (field / value) ───────────────────────────────

function SearchableDropdown({
  value,
  suggestions,
  onChange,
  placeholder,
  disabled,
  showSearch,
  noMatchText = '无匹配结果',
  emptyText = '暂无选项',
}: {
  value: string;
  suggestions: string[];
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
  showSearch?: boolean;
  noMatchText?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(value);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setInput(value), [value]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = useMemo(() => {
    if (!showSearch) return suggestions.slice(0, 30);
    if (!search.trim()) return suggestions.slice(0, 30);
    const lower = search.toLowerCase();
    return suggestions.filter((s) => s.toLowerCase().includes(lower)).slice(0, 30);
  }, [search, suggestions, showSearch]);

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      {/* Input row with dropdown button */}
      <div className="flex rounded-md border border-border-muted bg-background/42 focus-within:border-accent">
        <input
          ref={inputRef}
          type="text"
          value={open ? search : input}
          disabled={disabled}
          onChange={(e) => {
            if (open) {
              setSearch(e.target.value);
            } else {
              setInput(e.target.value);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              inputRef.current?.blur();
            } else if (e.key === 'Enter') {
              const confirmed = open ? search || input : input;
              setInput(confirmed);
              onChange(confirmed);
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          className="h-8 flex-1 min-w-0 bg-transparent pl-2 text-[12px] text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-40"
        />
        <button
          type="button"
          disabled={disabled}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!open) setSearch(input);
            setOpen(!open);
          }}
          className="flex w-7 items-center justify-center border-l border-border-muted text-text-muted hover:text-text-secondary transition-colors rounded-r-md disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-[180px] rounded-lg border border-border-muted bg-[var(--glass-card-strong)] py-1 shadow-elevated backdrop-blur-xl">
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-center text-[12px] text-text-muted">
                {search ? noMatchText : emptyText}
              </div>
            ) : (
              filtered.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`w-full px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-surface-hover ${
                    s === input ? 'text-accent' : 'text-text-secondary'
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setInput(s);
                    setSearch('');
                    onChange(s);
                    setOpen(false);
                  }}
                >
                  {s}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Value input (free text + dropdown suggestions) ───────────────────

function ValueInput({
  value,
  suggestions,
  isLoading,
  disabled,
  onChange,
  placeholder,
}: {
  value: string;
  suggestions: string[];
  isLoading: boolean;
  disabled?: boolean;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setInput(value), [value]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = useMemo(() => {
    if (!input) return suggestions.slice(0, 20);
    const lower = input.toLowerCase();
    return suggestions.filter((s) => s.toLowerCase().includes(lower)).slice(0, 20);
  }, [input, suggestions]);

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <div className="flex rounded-md border border-border-muted bg-background/42 focus-within:border-accent">
        <input
          type="text"
          value={input}
          disabled={disabled}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            else if (e.key === 'Enter') {
              onChange(input);
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          className="h-8 flex-1 min-w-0 bg-transparent pl-2 text-[12px] text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-40"
        />
        {isLoading && (
          <Loader2 className="my-auto h-3.5 w-3.5 flex-shrink-0 animate-spin text-text-muted" />
        )}
        <button
          type="button"
          disabled={disabled}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(!open);
          }}
          className="flex w-7 items-center justify-center border-l border-border-muted text-text-muted hover:text-text-secondary transition-colors rounded-r-md disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border border-border-muted bg-[var(--glass-card-strong)] py-1 shadow-elevated backdrop-blur-xl">
          <div className="max-h-40 overflow-y-auto">
            {filtered.map((s) => (
              <button
                key={s}
                type="button"
                className={`w-full px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-surface-hover ${
                  s === input ? 'text-accent' : 'text-text-secondary'
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setInput(s);
                  onChange(s);
                  setOpen(false);
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main FormFilter ───────────────────────────────────────────────────

export default function FormFilter({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
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

  const parsedFromConfig = useMemo(
    () => parseCondition(node.config.condition as string | undefined),
    [node.config.condition]
  );
  const [rows, setRows] = useState<ConditionRow[]>(parsedFromConfig);

  // Column metadata caches
  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({});
  const [columnValues, setColumnValues] = useState<Record<string, string[]>>({});
  const [loadingValues, setLoadingValues] = useState<Record<string, boolean>>({});

  const localUpdateRef = useRef(false);

  // Sync from external config changes
  useEffect(() => {
    if (localUpdateRef.current) {
      localUpdateRef.current = false;
      return;
    }
    const fromRows = buildFilterCondition(rows, columnTypes);
    const fromConfig = node.config.condition as string | undefined;
    if ((fromRows || undefined) === (fromConfig || undefined)) return;
    if (!eqRows(rows, parsedFromConfig)) {
      setRows(parsedFromConfig);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedFromConfig]);

  // Fetch column types
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

  // Fetch column distinct values
  function fetchColumnValues(colName: string) {
    if (!taskId || !sourceNode?.id || !colName) return;
    if (columnValues[colName] || loadingValues[colName]) return;
    const api = window.electronAPI?.data;
    if (!api?.getWorkflowNodeColumnValues) return;
    setLoadingValues((prev) => ({ ...prev, [colName]: true }));
    api
      .getWorkflowNodeColumnValues({
        taskId,
        nodeId: sourceNode.id,
        nodeType: sourceNode.type as never,
        nodeConfig: (sourceNode.config ?? {}) as Record<string, unknown>,
        column: colName,
      })
      .then((vals) => {
        setColumnValues((prev) => ({ ...prev, [colName]: vals }));
        setLoadingValues((prev) => ({ ...prev, [colName]: false }));
      })
      .catch(() => setLoadingValues((prev) => ({ ...prev, [colName]: false })));
  }

  function updateRows(next: ConditionRow[]) {
    setRows(next);
    const cond = buildFilterCondition(next, columnTypes);
    localUpdateRef.current = true;
    updateConfig((cfg) => ({ ...cfg, condition: cond }));
  }

  function updateRow(i: number, patch: Partial<ConditionRow>) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    if (patch.field && patch.field !== rows[i].field) {
      fetchColumnValues(patch.field);
    }
    updateRows(next);
  }

  function removeRow(i: number) {
    const next = rows.filter((_, idx) => idx !== i);
    updateRows(next);
  }

  function addRow() {
    updateRows([...rows, { ...EMPTY_ROW }]);
  }

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title={tr('filterTitle', '筛选条件')}>
        <div className="grid gap-1">
          {/* Empty state */}
          {rows.length === 0 && (
            <div className="rounded-lg border border-dashed border-border-muted/70 px-4 py-6 text-center">
              <p className="text-[12px] text-text-muted">
                {tr('filterEmptyHint', '尚未添加筛选条件，请点击下方按钮开始')}
              </p>
            </div>
          )}

          {/* Condition cards */}
          {rows.map((row, i) => {
            const fieldSelected = !!row.field;
            const colType = columnTypes[row.field];
            const ops = operatorsForType(colType);
            const validOps = ops.map((o) => o.value);
            const effectiveOp = validOps.includes(row.op) ? row.op : (ops[0]?.value ?? '=');
            const isBetween = effectiveOp === 'between';
            const colVals = columnValues[row.field] ?? [];
            const isValsLoading = loadingValues[row.field] ?? false;

            return (
              <div key={i}>
                {/* Connective separator pill (between conditions) */}
                {i > 0 && (
                  <div className="flex items-center justify-center py-1">
                    <button
                      type="button"
                      onClick={() =>
                        updateRow(i, { connective: row.connective === 'and' ? 'or' : 'and' })
                      }
                      className="rounded-full border border-border-muted/70 bg-background/60 px-3 py-0.5 text-[11px] font-semibold tracking-wider text-accent hover:bg-accent/10 hover:border-accent/30 transition-colors"
                      title={tr('filterToggleAndOr', '点击切换 AND / OR')}
                    >
                      {row.connective.toUpperCase()}
                    </button>
                  </div>
                )}

                {/* Condition card */}
                <div className="group relative rounded-lg border border-border-muted/60 bg-background/30 px-3 pb-2.5 pt-2.5">
                  {/* Row 1: field + operator */}
                  <div className="flex items-center gap-2">
                    {/* Field */}
                    <SearchableDropdown
                      value={row.field}
                      suggestions={fieldCompletions}
                      onChange={(v) => updateRow(i, { field: v, op: effectiveOp })}
                      placeholder={tr('filterFieldPlaceholder', '选择字段')}
                      showSearch
                      noMatchText={tr('noMatch', '无匹配字段')}
                      emptyText={tr('noFields', '暂无可用字段')}
                    />

                    {/* Operator */}
                    <div className="relative w-20 flex-shrink-0">
                      <select
                        value={effectiveOp}
                        disabled={!fieldSelected}
                        onChange={(e) => updateRow(i, { op: e.target.value })}
                        className={`${SELECT_BASE} w-20`}
                      >
                        {ops.map((o) => (
                          <option key={o.value} value={o.value}>
                            {tr(OP_LABEL_KEYS[o.value] ?? '', o.value)}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" />
                    </div>
                  </div>

                  {/* Row 2: values + delete */}
                  <div className="mt-2 flex items-center gap-2">
                    {/* Value 1 */}
                    <ValueInput
                      value={row.val1}
                      suggestions={colVals}
                      isLoading={isValsLoading}
                      onChange={(v) => updateRow(i, { val1: v })}
                      placeholder={tr('filterValuePlaceholder', '值')}
                      disabled={!fieldSelected}
                    />

                    {/* Value 2 (between only) */}
                    {isBetween && (
                      <span className="text-[11px] text-text-muted flex-shrink-0">
                        {tr('filterAnd', '至')}
                      </span>
                    )}
                    {isBetween && (
                      <ValueInput
                        value={row.val2}
                        suggestions={colVals}
                        isLoading={isValsLoading}
                        onChange={(v) => updateRow(i, { val2: v })}
                        placeholder={tr('filterValue2Placeholder', '值2')}
                        disabled={!fieldSelected}
                      />
                    )}

                    {/* Delete */}
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-muted/50 hover:text-error hover:bg-error/10 transition-colors"
                      title={tr('filterDeleteCondition', '删除此条件')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add button */}
        <button
          type="button"
          onClick={addRow}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-muted/70 py-2 text-[12px] text-text-muted hover:border-accent/40 hover:text-accent transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          {tr('filterAddCondition', '添加筛选条件')}
        </button>

        {/* Hint */}
        <p className="mt-2 text-[10px] leading-relaxed text-text-muted">
          {tr('filterHint', '多个条件以 AND/OR 连接。选择字段后自动加载列值建议。')}
        </p>
      </GlassFormSection>
    </div>
  );
}
