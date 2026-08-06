import { useCallback, useMemo, useState } from 'react';
import type { OperatorFormProps } from './index';
import { GlassTagBar } from './shared/GlassTagBar';
import { GlassExpressionInput } from './shared/GlassExpressionInput';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassFieldMultiSelect } from './shared/GlassFieldMultiSelect';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassRowList, type RowAction } from './shared/GlassRowList';
import { useWorkflowNodeColumnValues } from '../../hooks/useWorkflowNodeColumnValues';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';

const PIVOT_FUNCTIONS = ['sum', 'avg', 'min', 'max', 'count', 'count_distinct'];

interface PivotMetric {
  function: string;
  expression: string;
  alias?: string;
}

function createDefaultMetric(): PivotMetric {
  return { function: 'count', expression: '*', alias: undefined };
}

export default function FormPivot({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation();
  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });
  const updateConfig = useUpdateConfig(onNodeChange);

  const onFields = useMemo(() => (node.config.on as string[]) ?? [], [node.config?.on]);
  const values = useMemo(() => {
    const raw = node.config.values;
    if (Array.isArray(raw)) return raw as string[];
    if (raw && typeof raw === 'object') {
      const record = raw as Record<string, unknown>;
      const first = onFields[0];
      if (first && Array.isArray(record[first])) return record[first] as string[];
    }
    return [];
  }, [node?.config?.values, onFields]);
  const rawUsing = useMemo(() => (node.config.using as PivotMetric[]) ?? [], [node.config?.using]);
  const using = useMemo(
    () => (rawUsing.length > 0 ? rawUsing : [createDefaultMetric()]),
    [rawUsing]
  );
  const groupBy = useMemo(() => (node.config.groupBy as string[]) ?? [], [node.config?.groupBy]);

  const makeArrayHandler = useCallback(
    (key: string) => (next: string[]) =>
      updateConfig((cfg) => ({ ...cfg, [key]: next.length > 0 ? next : undefined })),
    [updateConfig]
  );

  const handleOnChange = useCallback(
    (next: string[]) => {
      updateConfig((cfg) => {
        const previous = (cfg.on as string[] | undefined) ?? [];
        const firstFieldChanged = previous[0] !== next[0];
        return {
          ...cfg,
          on: next.length > 0 ? next : undefined,
          values: firstFieldChanged ? undefined : cfg.values,
        };
      });
    },
    [updateConfig]
  );
  const handleGroupByChange = useMemo(() => makeArrayHandler('groupBy'), [makeArrayHandler]);
  const handleValuesChange = useCallback(
    (next: string[]) => {
      updateConfig((cfg) => {
        const first = (cfg.on as string[] | undefined)?.[0];
        if (!first) return cfg;
        const current =
          cfg.values && typeof cfg.values === 'object' && !Array.isArray(cfg.values)
            ? (cfg.values as Record<string, unknown>)
            : {};
        return {
          ...cfg,
          values: next.length > 0 ? { ...current, [first]: next } : current,
        };
      });
    },
    [updateConfig]
  );

  const removeOn = useCallback(
    (col: string) => handleOnChange(onFields.filter((c) => c !== col)),
    [handleOnChange, onFields]
  );

  const clearOn = useCallback(() => handleOnChange([]), [handleOnChange]);

  const removeGroupBy = useCallback(
    (col: string) => handleGroupByChange(groupBy.filter((c) => c !== col)),
    [handleGroupByChange, groupBy]
  );

  const clearGroupBy = useCallback(() => handleGroupByChange([]), [handleGroupByChange]);

  const [onOpen, setOnOpen] = useState(false);
  const [groupByOpen, setGroupByOpen] = useState(false);
  const [valueListOpen, setValueListOpen] = useState(false);

  const distinctValues = useWorkflowNodeColumnValues({
    taskId,
    sourceNode,
    column: onFields[0],
  });

  // ── 多指标管理 ──

  const handleUsingChange = useCallback(
    (items: PivotMetric[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        using: items.length > 0 ? items : undefined,
      }));
    },
    [updateConfig]
  );

  function updateMetric(index: number, patch: Partial<PivotMetric>) {
    handleUsingChange(using.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function addMetricAfter(index: number) {
    const hasEmpty = using.some((m) => !m.expression);
    if (hasEmpty) return;
    const entry = createDefaultMetric();
    handleUsingChange([...using.slice(0, index + 1), entry, ...using.slice(index + 1)]);
  }

  function removeMetric(index: number) {
    if (using.length <= 1) return;
    let next = using.filter((_, i) => i !== index);
    const firstEmpty = next.findIndex((m) => !m.expression);
    if (firstEmpty >= 0) {
      next = next.filter((m, i) => i === firstEmpty || m.expression);
    }
    handleUsingChange(next);
  }

  const fnGroups = useMemo(
    () => [
      {
        key: 'fn',
        items: PIVOT_FUNCTIONS.map((f) => ({
          value: f,
          label: tr(`aggregateFn_${f}`),
        })),
      },
    ],
    [tr]
  );

  return (
    <div className="flex gap-2.5">
      {/* ═══ 左列: 列与分组 ═══ */}
      <div className="flex-[4] rounded-lg border border-border-muted bg-background/42 content-start">
        <div className="flex items-end gap-3 px-3 pt-2.5 pb-1.5">
          <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
            1
          </span>
          <div className="grid">
            <span className="text-[13px] font-semibold text-text-primary">{tr('pivotAxes')}</span>
            <span className="text-[10px] text-text-muted">{tr('pivotSourcesHint')}</span>
          </div>
        </div>
        <div className="px-3 pb-3 grid gap-3 content-start">
          <div className="grid gap-1.5 content-start">
            <span className="mb-1 block text-[12px] font-medium text-text-secondary">
              {tr('pivotOnLabel')}
            </span>
            <GlassTagBar
              items={onFields}
              onRemove={removeOn}
              onClear={clearOn}
              open={onOpen}
              onToggle={() => setOnOpen((v) => !v)}
              toggleStyle="chevron"
              density="default"
              className="min-h-7"
              placeholder={tr('noFieldsSelected')}
            />
            {onOpen && (
              <GlassFieldMultiSelect
                columns={fieldCompletions}
                selected={onFields}
                onChange={handleOnChange}
                columnTypes={columnTypes}
                maxHeight="180px"
              />
            )}
          </div>
          <div className="grid gap-1">
            <span className="mb-1 block text-[12px] font-medium text-text-secondary">
              {tr('pivotInLabel')}
              <span className="text-[10px] text-text-muted ml-1">({tr('optional')})</span>
            </span>
            <GlassTagBar
              items={values}
              onRemove={(col) => handleValuesChange(values.filter((c) => c !== col))}
              onClear={() => handleValuesChange([])}
              open={valueListOpen}
              onToggle={() => setValueListOpen((v) => !v)}
              toggleStyle="chevron"
              density="default"
              placeholder={tr('pivotInPlaceholder')}
            />
            {valueListOpen && (
              <GlassFieldMultiSelect
                columns={distinctValues}
                selected={values}
                onChange={handleValuesChange}
                maxHeight="180px"
                allowCustomValue
                inputPlaceholder={tr('pivotInPlaceholder')}
              />
            )}
          </div>
          <div className="grid gap-1.5 content-start">
            <span className="mb-1 block text-[12px] font-medium text-text-secondary">
              {tr('pivotGroupByLabel')}
              <span className="text-[10px] text-text-muted ml-1">({tr('optional')})</span>
            </span>
            <GlassTagBar
              items={groupBy}
              onRemove={removeGroupBy}
              onClear={clearGroupBy}
              open={groupByOpen}
              onToggle={() => setGroupByOpen((v) => !v)}
              toggleStyle="chevron"
              density="default"
              className="min-h-7"
              placeholder={tr('noFieldsSelected')}
            />
            {groupByOpen && (
              <GlassFieldMultiSelect
                columns={fieldCompletions}
                selected={groupBy}
                onChange={handleGroupByChange}
                columnTypes={columnTypes}
                maxHeight="180px"
              />
            )}
          </div>
        </div>
      </div>

      {/* ═══ 右列: 聚合指标 ═══ */}
      <div className="flex-[6] rounded-lg border border-border-muted bg-background/42 content-start">
        <div className="flex items-end gap-3 px-3 pt-2.5 pb-1.5">
          <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
            2
          </span>
          <div className="grid">
            <span className="text-[13px] font-semibold text-text-primary">{tr('pivotUsing')}</span>
            <span className="text-[10px] text-text-muted">{tr('pivotAggHint')}</span>
          </div>
        </div>
        <div className="px-3 pb-3 grid gap-3 content-start">
          <GlassRowList
            headerClassName="text-[12px]"
            items={using}
            columns={[
              {
                flex: 'flex-[1.5]',
                header: tr('aggregateFunction'),
                render: (metric: PivotMetric, i: number) => (
                  <GlassOptionSingleSelect
                    value={metric.function}
                    groups={fnGroups}
                    onChange={(v) => updateMetric(i, { function: v })}
                    className="h-7 text-[12px] [&>span]:text-left w-full"
                  />
                ),
              },
              {
                flex: 'flex-[2]',
                header: tr('expressionLabel'),
                render: (metric: PivotMetric, i: number) => (
                  <GlassExpressionInput
                    value={metric.expression}
                    onChange={(v) => updateMetric(i, { expression: v })}
                    fieldCompletions={fieldCompletions}
                    columnTypes={columnTypes}
                    placeholder={tr('pivotExpressionPlaceholder')}
                  />
                ),
              },
              {
                flex: 'flex-[1.5]',
                header: tr('aggregateAlias'),
                render: (metric: PivotMetric, i: number) => (
                  <GlassFormTextInput
                    value={metric.alias ?? ''}
                    onChange={(v) => updateMetric(i, { alias: v || undefined })}
                    placeholder={tr('pivotAliasPlaceholder')}
                    className="h-7 px-1.5 text-[12px] w-full"
                  />
                ),
              },
            ]}
            onAdd={(i) => addMetricAfter(i)}
            onRemove={(i) => removeMetric(i)}
            addTitle={tr('pivotAddMetric')}
            removeTitle={tr('pivotRemoveMetric')}
            canAct={(action: RowAction) =>
              action === 'add' ? !using.some((m) => !m.expression) : true
            }
          />
        </div>
      </div>
    </div>
  );
}
