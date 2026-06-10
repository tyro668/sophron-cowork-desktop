import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import {
  isNumericDataFieldType,
  isTemporalDataFieldType,
  normalizeDataFieldType,
} from '../../../shared/data-field-types';

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
  if (isNumericDataFieldType(type)) {
    return ALL_OPERATORS;
  }
  if (type === 'text') {
    return STRING_OPS;
  }
  if (isTemporalDataFieldType(type)) {
    return ALL_OPERATORS;
  }
  if (type === 'boolean') {
    return BOOLEAN_OPS;
  }
  return ALL_OPERATORS;
}

type Connective = 'and' | 'or';

interface ConditionRow {
  field: string;
  op: string;
  val1: string;
  val2: string;
  connective: Connective;
}

const EMPTY_ROW: ConditionRow = { field: '', op: '=', val1: '', val2: '', connective: 'and' };

function parseSingleCondition(expr: string): ConditionRow {
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
  return { ...EMPTY_ROW };
}

function parseCondition(condition: string | undefined): ConditionRow[] {
  if (!condition) return [{ ...EMPTY_ROW }];
  // Protect "between X and Y" segments before splitting
  const betweenPattern = /\[([^\]]+)\]\s+between\s+(.+?)\s+and\s+(.+?)(?=\s*(?:$|and\s|or\s))/gi;
  const placeholders: string[] = [];
  const protected_ = condition.replace(betweenPattern, (_m, field, v1, v2) => {
    const idx = placeholders.length;
    placeholders.push(`[${field}] between ${v1} %%PH%% ${v2}`);
    return `__BETWEEN_${idx}__`;
  });

  // Split capturing both "and" and "or" connectives
  // tokens: ['[a] > 0', ' and ', '[b] = "x"', ' or ', '[c] < 10']
  const tokens = protected_.split(/(\s+(?:and|or)\s+)/i);
  const rows: ConditionRow[] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const expr = tokens[i];
    if (!expr?.trim()) continue;
    const restored = expr.replace(/__BETWEEN_(\d+)__/g, (_m, idx) => {
      return placeholders[Number(idx)] ?? _m;
    });
    const row = parseSingleCondition(restored.trim());
    // Connective from the token BEFORE this expression
    const connectiveToken = tokens[i - 1];
    row.connective = connectiveToken ? (connectiveToken.trim().toLowerCase() as Connective) : 'and';
    rows.push(row);
  }
  return rows.length > 0 ? rows : [{ ...EMPTY_ROW }];
}

function buildCondition(rows: ConditionRow[]): string | undefined {
  const parts: { expr: string; connective: Connective }[] = [];
  for (const row of rows) {
    const { field, op, val1, val2 } = row;
    if (!field || !op || !val1) continue;
    if (op === 'between' && !val2) continue;
    const expr =
      op === 'between' ? `[${field}] between ${val1} and ${val2}` : `[${field}] ${op} ${val1}`;
    parts.push({ expr, connective: row.connective });
  }
  if (parts.length === 0) return undefined;
  let out = parts[0].expr;
  for (let i = 1; i < parts.length; i++) {
    out += ` ${parts[i].connective} ${parts[i].expr}`;
  }
  return out;
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

/** Searchable dropdown for field selection. */
function SearchableFieldSelect({
  value,
  suggestions,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  suggestions: string[];
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
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
    <div ref={ref} className="relative min-w-0 flex-[2]">
      <input
        type="text"
        value={input}
        disabled={disabled}
        onChange={(e) => {
          setInput(e.target.value);
          setOpen(true);
        }}
        onFocus={() => !disabled && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onChange(input);
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none focus:border-accent placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-50"
      />
      {open && filtered.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-0.5 max-h-40 w-full overflow-y-auto rounded-md border border-border-muted bg-[var(--glass-card-strong)] py-0.5 shadow-elevated backdrop-blur-xl">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              className="w-full px-2 py-1 text-left text-[12px] text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors"
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
      )}
    </div>
  );
}

const SELECT_CLASS =
  'h-7 rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-secondary outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-50';

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

  // Column types cache: { [fieldName]: typeString }
  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({});
  // Column values cache: { [fieldName]: string[] }
  const [columnValues, setColumnValues] = useState<Record<string, string[]>>({});
  const [loadingValues, setLoadingValues] = useState<Record<string, boolean>>({});

  // Ref to prevent local updates from triggering external-sync reset
  const localUpdateRef = useRef(false);

  useEffect(() => {
    if (localUpdateRef.current) {
      localUpdateRef.current = false;
      return;
    }
    if (!eqRows(rows, parsedFromConfig)) {
      setRows(parsedFromConfig);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedFromConfig]);

  // Fetch column types using the upstream source node (which has a cached preview table)
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
        for (const t of types) {
          map[t.name] = t.type;
        }
        setColumnTypes(map);
      })
      .catch(() => setColumnTypes({}));
  }, [taskId, sourceNode?.id, sourceNode?.type, sourceNode?.config]);

  // Fetch column distinct values using the upstream source node
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
    const cond = buildCondition(next);
    localUpdateRef.current = true;
    updateConfig((cfg) => ({ ...cfg, condition: cond }));
  }

  function updateRow(i: number, patch: Partial<ConditionRow>) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    // Fetch column values when field changes
    if (patch.field && patch.field !== rows[i].field) {
      fetchColumnValues(patch.field);
    }
    updateRows(next);
  }

  function removeRow(i: number) {
    const next = rows.filter((_, idx) => idx !== i);
    updateRows(next.length > 0 ? next : [{ ...EMPTY_ROW }]);
  }

  function addRow() {
    updateRows([...rows, { ...EMPTY_ROW }]);
  }

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title={tr('filterTitle', '筛选条件')}>
        <div className="space-y-2">
          {rows.map((row, i) => {
            const fieldSelected = !!row.field;
            const colType = columnTypes[row.field];
            const ops = operatorsForType(colType);
            // Reset op if current op is not in allowed list
            const validOps = ops.map((o) => o.value);
            const effectiveOp = validOps.includes(row.op) ? row.op : (ops[0]?.value ?? '=');
            const isBetween = effectiveOp === 'between';
            const colVals = columnValues[row.field] ?? [];
            const isValsLoading = loadingValues[row.field] ?? false;

            return (
              <div key={i} className="flex items-center gap-1.5">
                {i > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      updateRow(i, { connective: row.connective === 'and' ? 'or' : 'and' })
                    }
                    className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-accent hover:bg-accent/10 transition-colors"
                    title={tr('filterToggleAndOr', '点击切换 AND / OR')}
                  >
                    {row.connective.toUpperCase()}
                  </button>
                )}

                {/* Field */}
                <SearchableFieldSelect
                  value={row.field}
                  suggestions={fieldCompletions}
                  onChange={(v) => updateRow(i, { field: v, op: effectiveOp })}
                  placeholder={tr('filterFieldPlaceholder', '字段')}
                />

                {/* Operator — disabled until field selected */}
                <select
                  value={effectiveOp}
                  disabled={!fieldSelected}
                  onChange={(e) => updateRow(i, { op: e.target.value })}
                  className={`${SELECT_CLASS} w-20 shrink-0`}
                >
                  {ops.map((o) => (
                    <option key={o.value} value={o.value}>
                      {tr(OP_LABEL_KEYS[o.value] ?? '', o.value)}
                    </option>
                  ))}
                </select>

                {/* Value 1 — disabled until field selected */}
                <ValueInput
                  value={row.val1}
                  suggestions={colVals}
                  isLoading={isValsLoading}
                  disabled={!fieldSelected}
                  onChange={(v) => updateRow(i, { val1: v })}
                  placeholder={tr('filterValuePlaceholder', '值')}
                />

                {/* Value 2 (between only) */}
                {isBetween && (
                  <ValueInput
                    value={row.val2}
                    suggestions={colVals}
                    isLoading={isValsLoading}
                    disabled={!fieldSelected}
                    onChange={(v) => updateRow(i, { val2: v })}
                    placeholder={tr('filterValue2Placeholder', '值2')}
                  />
                )}

                {/* Remove */}
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-error transition-colors"
                  title={tr('filterDeleteCondition', '删除此条件')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={addRow}
          className="mt-2 inline-flex h-7 items-center gap-1 rounded-md border border-border-muted bg-background/42 px-2 text-[11px] text-text-secondary hover:border-accent/30 hover:text-accent transition-colors"
        >
          <Plus className="h-3 w-3" />
          {tr('filterAddCondition', '添加筛选条件')}
        </button>

        <p
          className="mt-2 text-[10px] leading-relaxed text-text-muted"
          dangerouslySetInnerHTML={{
            __html: tr('filterHint', '多个条件以 <b>AND</b> 连接。字段选中后自动加载列值建议。'),
          }}
        />
      </GlassFormSection>
    </div>
  );
}

/** Value input with dropdown suggestions from column data. */
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
    <div ref={ref} className="relative min-w-0 flex-[2]">
      <div className="relative">
        <input
          type="text"
          value={input}
          disabled={disabled}
          onChange={(e) => {
            setInput(e.target.value);
            setOpen(true);
          }}
          onFocus={() => !disabled && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onChange(input);
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          className="h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 pr-6 text-[12px] text-text-primary outline-none focus:border-accent placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-50"
        />
        {isLoading && (
          <Loader2 className="absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-text-muted" />
        )}
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-0.5 max-h-40 w-full overflow-y-auto rounded-md border border-border-muted bg-[var(--glass-card-strong)] py-0.5 shadow-elevated backdrop-blur-xl">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              className="w-full px-2 py-1 text-left text-[12px] text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors"
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
      )}
    </div>
  );
}
