import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassRowList } from './shared/GlassRowList';
import { GlassExpressionInput } from './shared/GlassExpressionInput';
import {
  createCalculationRow,
  needsCalculationIdNormalization,
  normalizeCalculationEntries,
  type CalculationConfigEntry,
  type CalculationRow,
} from './shared/calculate-field';

export default function FormCalculateField({
  node,
  fieldCompletions,
  sourceNode,
  taskId,
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
      .then((types: Array<{ name: string; type: string }>) => {
        const map: Record<string, string> = {};
        for (const t of types) map[t.name] = t.type;
        setColumnTypes(map);
      })
      .catch(() => console.error('Failed to fetch column types for calculate field form'));
  }, [taskId, sourceNode?.id, sourceNode?.type, sourceNode?.config]);

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

  function updateItem(index: number, patch: Partial<CalculationRow>) {
    handleChange(calculations.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function addAfter(index: number) {
    const entry = createCalculationRow();
    handleChange([...calculations.slice(0, index + 1), entry, ...calculations.slice(index + 1)]);
  }

  function removeItem(index: number) {
    handleChange(calculations.filter((_, i) => i !== index));
  }

  const items = calculations.length > 0 ? calculations : [createCalculationRow()];

  return (
    <div className="flex flex-col min-h-0 overflow-hidden" style={{ height: '100%' }}>
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-2.5">
        <GlassFormSection className="flex-1 min-h-0 overflow-y-auto">
          <GlassRowList
            items={items}
            columns={[
              {
                flex: 'flex-[2]',
                header: tr('calcFieldTargetField', '目标字段'),
                render: (item: CalculationRow, index) => (
                  <input
                    type="text"
                    value={item.field}
                    onChange={(e) => updateItem(index, { field: e.target.value })}
                    placeholder={tr('calcFieldTargetPlaceholder', '如 margin')}
                    className={`h-7 w-full rounded-md border border-border-muted bg-background/42 px-1.5 text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent ${
                      !item.field.trim() ? '!border-warning/60' : ''
                    }`}
                  />
                ),
              },
              {
                flex: 'flex-[5]',
                header: tr('calcFieldExpressionLabel', '表达式'),
                render: (item: CalculationRow, index) => (
                  <GlassExpressionInput
                    value={item.expression}
                    onChange={(v) => updateItem(index, { expression: v })}
                    fieldCompletions={fieldCompletions}
                    columnTypes={columnTypes}
                    placeholder={tr('calcFieldExpressionPlaceholder', '如 [revenue] - [cost]')}
                  />
                ),
              },
            ]}
            onAdd={addAfter}
            onRemove={removeItem}
            addTitle={tr('calcFieldAddRule', '添加规则')}
            removeTitle={tr('calcFieldRemove', '删除规则')}
          />
        </GlassFormSection>
      </div>
    </div>
  );
}
