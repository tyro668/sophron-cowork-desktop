import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import type { OperatorFormProps } from './index';
import {
  createCalculationRow,
  needsCalculationIdNormalization,
  normalizeCalculationEntries,
  type CalculationConfigEntry,
  type CalculationRow,
} from './shared/calculate-field';

interface HelperToken {
  label: string;
  apply: string;
  cursorOffset?: number;
}

type HelperTab = 'fields' | 'functions';
type TouchedState = Record<string, { field?: boolean; expression?: boolean }>;

function functionToken(label: string): HelperToken {
  return { label, apply: `${label}()`, cursorOffset: label.length + 1 };
}

const FIELD_INPUT_CLASS =
  'min-h-[40px] w-full rounded-md border border-border-muted/70 bg-background/34 px-2 text-[12px] text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/15';

const EXPRESSION_INPUT_CLASS =
  'min-h-[72px] w-full resize-y rounded-md border border-border-muted/70 bg-background/34 px-2 py-1.5 font-mono text-[12px] leading-5 text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/15';

const CHIP_CLASS =
  'inline-flex h-6 max-w-full cursor-pointer items-center rounded-md border border-border-muted/70 bg-background/28 px-2 text-[11px] text-text-secondary transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent';

const FUNCTION_GROUPS: Array<{ i18nKey: string; tokens: HelperToken[] }> = [
  {
    i18nKey: 'calcFieldCategoryCondition',
    tokens: [
      { label: 'if', apply: 'if ' },
      { label: 'then', apply: ' then ' },
      { label: 'else', apply: ' else ' },
    ],
  },
  {
    i18nKey: 'calcFieldCategoryWindow',
    tokens: ['row_number', 'rank', 'lag', 'lead'].map(functionToken),
  },
  {
    i18nKey: 'calcFieldCategoryAggregate',
    tokens: ['sum', 'avg', 'count', 'min', 'max'].map(functionToken),
  },
  {
    i18nKey: 'calcFieldCategoryMath',
    tokens: ['abs', 'round'].map(functionToken),
  },
  {
    i18nKey: 'calcFieldCategoryString',
    tokens: ['upper', 'lower', 'trim', 'length', 'substr', 'split_part', 'concat'].map(
      functionToken
    ),
  },
  {
    i18nKey: 'calcFieldCategoryNull',
    tokens: ['coalesce', 'nullif'].map(functionToken),
  },
  {
    i18nKey: 'calcFieldCategoryType',
    tokens: [{ label: 'CAST', apply: 'CAST( AS )', cursorOffset: 5 }],
  },
];

export default function FormCalculateField({
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

  const rawCalculations = useMemo(
    () => (node.config.calculations as CalculationConfigEntry[] | undefined) ?? [],
    [node.config.calculations]
  );
  const calculations = useMemo(
    () => normalizeCalculationEntries(rawCalculations),
    [rawCalculations]
  );
  const needsNormalization = useMemo(
    () => needsCalculationIdNormalization(rawCalculations),
    [rawCalculations]
  );
  const exprInputRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const [activeCalculationId, setActiveCalculationId] = useState<string | null>(null);
  const [helperTab, setHelperTab] = useState<HelperTab>('fields');
  const [touched, setTouched] = useState<TouchedState>({});

  const activeCalculation =
    (activeCalculationId
      ? calculations.find((item) => item.id === activeCalculationId)
      : undefined) ??
    calculations[0] ??
    null;
  const activeIndex = activeCalculation
    ? calculations.findIndex((item) => item.id === activeCalculation.id)
    : -1;

  const storeCalculations = useCallback(
    (items: CalculationRow[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        calculations: items.length > 0 ? items : undefined,
      }));
    },
    [updateConfig]
  );

  useEffect(() => {
    if (!needsNormalization) return;
    storeCalculations(calculations);
  }, [calculations, needsNormalization, storeCalculations]);

  function handleChange(items: CalculationRow[]) {
    storeCalculations(normalizeCalculationEntries(items));
  }

  function updateItem(id: string, patch: Partial<CalculationRow>) {
    storeCalculations(
      calculations.map((existing) => (existing.id === id ? { ...existing, ...patch } : existing))
    );
  }

  function addCalculation() {
    const next = [...calculations, createCalculationRow()];
    handleChange(next);
    setActiveCalculationId(next[next.length - 1]?.id ?? null);
  }

  function removeCalculation(id: string, index: number) {
    const next = calculations.filter((item) => item.id !== id);
    handleChange(next);
    exprInputRefs.current.delete(id);
    setTouched((current) => {
      if (!current[id]) return current;
      const nextTouched = { ...current };
      delete nextTouched[id];
      return nextTouched;
    });
    setActiveCalculationId(next[Math.min(index, next.length - 1)]?.id ?? null);
  }

  function markTouched(id: string, key: 'field' | 'expression') {
    setTouched((current) => ({
      ...current,
      [id]: {
        ...current[id],
        [key]: true,
      },
    }));
  }

  function showFieldError(item: CalculationRow): boolean {
    const state = touched[item.id];
    return !item.field.trim() && (Boolean(item.expression.trim()) || state?.field === true);
  }

  function showExpressionError(item: CalculationRow): boolean {
    const state = touched[item.id];
    return !item.expression.trim() && (Boolean(item.field.trim()) || state?.expression === true);
  }

  function insert(text: string, cursorOffset = text.length) {
    const item = activeCalculation;
    if (!item) return;
    const el = exprInputRefs.current.get(item.id);
    if (!el) return;

    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    updateItem(item.id, { expression: next });
    setActiveCalculationId(item.id);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + cursorOffset;
      el.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <div className="grid content-start gap-2 text-[12px]">
      <section className="overflow-hidden rounded-lg border border-border-muted/70 bg-background/18">
        <div className="flex min-h-9 items-center gap-2 border-b border-border-muted/60 px-2.5 py-1.5">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-text-primary">
              {tr('calcFieldTitle', '计算字段')}
            </div>
            <div className="text-[11px] text-text-muted">
              {calculations.length > 0
                ? tr('calcFieldRuleCount', '{{count}} 条公式规则').replace(
                    '{{count}}',
                    String(calculations.length)
                  )
                : tr('calcFieldZeroRules', '0 条公式规则')}
            </div>
          </div>
        </div>

        <div className="grid gap-1.5 p-2">
          {calculations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-muted/70 bg-background/16 px-3 py-5 text-center">
              <div className="text-[12px] text-text-secondary">
                {tr('calcFieldEmpty', '暂无计算字段')}
              </div>
              <div className="mt-1 text-[11px] text-text-muted">
                {tr('calcFieldEmptyHint', '添加一条规则后填写目标字段和表达式')}
              </div>
            </div>
          ) : (
            calculations.map((item, index) => {
              const isActive = activeCalculation?.id === item.id;
              const fieldError = showFieldError(item);
              const expressionError = showExpressionError(item);
              return (
                <div
                  key={item.id}
                  className={`group/rule rounded-lg border px-2.5 py-2 transition-colors ${
                    isActive
                      ? 'border-accent/35 bg-accent/5'
                      : 'border-border-muted/55 bg-background/16 hover:border-border-muted/80'
                  }`}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="inline-flex h-5 items-center rounded bg-background/42 px-1.5 text-[10px] font-medium text-text-muted">
                        #{index + 1}
                      </span>
                      <span className="truncate text-[11px] text-text-muted">
                        {isActive
                          ? tr('calcFieldActiveRule', '当前编辑规则')
                          : tr('calcFieldRule', '计算规则')}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeCalculation(item.id, index)}
                      className="flex h-6 w-6 items-center justify-center rounded text-text-muted opacity-0 transition-opacity hover:bg-surface-hover hover:text-error group-hover/rule:opacity-100"
                      title={tr('remove', '删除')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="grid gap-2 lg:grid-cols-[minmax(8rem,0.32fr)_minmax(0,1fr)]">
                    <label className="grid content-start gap-1">
                      <span className="text-[11px] font-medium text-text-secondary">
                        {tr('calcFieldTargetField', '目标字段')}{' '}
                        <span className="text-error">*</span>
                      </span>
                      <textarea
                        rows={2}
                        maxLength={128}
                        value={item.field}
                        onChange={(e) => updateItem(item.id, { field: e.target.value })}
                        onFocus={() => setActiveCalculationId(item.id)}
                        onBlur={() => markTouched(item.id, 'field')}
                        placeholder={tr('calcFieldTargetPlaceholder', '如 margin')}
                        aria-invalid={fieldError}
                        className={`${FIELD_INPUT_CLASS} resize-none ${
                          fieldError ? '!border-warning/70 !ring-warning/10' : ''
                        }`}
                      />
                    </label>

                    <label className="grid min-w-0 gap-1">
                      <span className="text-[11px] font-medium text-text-secondary">
                        {tr('calcFieldExpressionLabel', '表达式')}{' '}
                        <span className="text-error">*</span>
                      </span>
                      <textarea
                        ref={(el) => {
                          if (el) exprInputRefs.current.set(item.id, el);
                          else exprInputRefs.current.delete(item.id);
                        }}
                        value={item.expression}
                        onChange={(e) => updateItem(item.id, { expression: e.target.value })}
                        onFocus={() => setActiveCalculationId(item.id)}
                        onBlur={() => markTouched(item.id, 'expression')}
                        placeholder={tr(
                          'calcFieldExpressionPlaceholder',
                          '如 [revenue] - [cost] 或 if [a] > 0 then 1 else 0'
                        )}
                        aria-invalid={expressionError}
                        className={`${EXPRESSION_INPUT_CLASS} ${
                          expressionError ? '!border-warning/70 !ring-warning/10' : ''
                        }`}
                      />
                    </label>
                  </div>

                  {(fieldError || expressionError) && (
                    <div className="mt-1.5 text-[11px] text-warning">
                      {fieldError && expressionError
                        ? tr('calcFieldCompleteBoth', '请补全目标字段和表达式')
                        : fieldError
                          ? tr('calcFieldCompleteField', '请补全目标字段')
                          : tr('calcFieldCompleteExpr', '请补全表达式')}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="border-t border-border-muted/60 px-2 pb-2 pt-1.5">
          <button
            type="button"
            onClick={addCalculation}
            className="inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border-muted/70 bg-background/16 text-[12px] text-text-secondary transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-accent"
          >
            <Plus className="h-3.5 w-3.5" />
            {tr('calcFieldAddRule', '添加规则')}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-border-muted/60 bg-background/16 p-2">
        <div className="mb-1.5 flex min-h-7 items-center justify-between gap-2">
          <div className="min-w-0 text-[11px] font-medium text-text-secondary">
            {tr('calcFieldInsertTo', '插入到')}
            {calculations.length > 0
              ? tr('calcFieldExpressionNth', '第 {{n}} 条表达式').replace(
                  '{{n}}',
                  String(activeIndex + 1)
                )
              : tr('calcFieldExpressionLabel', '表达式')}
          </div>
          <div className="inline-flex rounded-md bg-surface-active/70 p-0.5">
            {(['fields', 'functions'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setHelperTab(tab)}
                className={`h-6 rounded px-2 text-[11px] font-medium transition-colors ${
                  helperTab === tab
                    ? 'bg-background/70 text-accent shadow-soft'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {tab === 'fields'
                  ? tr('calcFieldTabFields', '字段')
                  : tr('calcFieldTabFunctions', '函数')}
              </button>
            ))}
          </div>
        </div>

        {helperTab === 'fields' ? (
          <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto pr-0.5">
            {fieldCompletions.length > 0 ? (
              fieldCompletions.map((col) => (
                <button
                  key={col}
                  type="button"
                  onClick={() => insert(`[${col}]`)}
                  disabled={calculations.length === 0}
                  className={`${CHIP_CLASS} disabled:cursor-not-allowed disabled:opacity-45`}
                  title={tr('calcFieldInsertField', '插入字段 {{name}}').replace('{{name}}', col)}
                >
                  <span className="truncate">{col}</span>
                </button>
              ))
            ) : (
              <span className="text-[11px] text-text-muted">{tr('noFields', '暂无可用字段')}</span>
            )}
          </div>
        ) : (
          <div className="grid max-h-28 gap-1.5 overflow-y-auto pr-0.5">
            {FUNCTION_GROUPS.map((group) => (
              <div key={group.i18nKey} className="flex min-w-0 items-start gap-1.5">
                <span className="mt-0.5 w-9 flex-shrink-0 text-[10px] text-text-muted">
                  {tr(group.i18nKey, group.i18nKey)}
                </span>
                <div className="flex min-w-0 flex-wrap gap-1">
                  {group.tokens.map((token) => (
                    <button
                      key={token.label}
                      type="button"
                      onClick={() => insert(token.apply, token.cursorOffset)}
                      disabled={calculations.length === 0}
                      className={`${CHIP_CLASS} font-mono disabled:cursor-not-allowed disabled:opacity-45`}
                      title={tr('calcFieldInsertFn', '插入 {{name}}').replace(
                        '{{name}}',
                        token.label
                      )}
                    >
                      {token.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
