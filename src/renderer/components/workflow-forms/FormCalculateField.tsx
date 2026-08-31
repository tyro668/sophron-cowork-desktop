import { useCallback, useEffect, useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { CalculateFieldExpressionInput } from './calculate-field/CalculateFieldExpressionInput';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassRowList, type GlassRowListColumn } from './shared/GlassRowList';
import { canAppendRow, insertRowAfter } from './shared/rowListOperations';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { useDragReorder } from '../../hooks/useDragReorder';
import {
  createCalculationRow,
  normalizeCalculationEntries,
  type CalculationConfigEntry,
  type CalculationRow,
} from '../../../shared/calculate-field';
import { MAX_CALCULATION_COUNT } from '../../../shared/operator-schemas';

function persistableCalculation(row: CalculationRow): CalculationConfigEntry {
  return {
    id: row.id,
    field: row.field,
    expression: row.expression,
    action: row.action,
  };
}

export default function FormCalculateField({
  node,
  fieldCompletions,
  sourceNode,
  taskId,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('calculateField');
  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });
  const updateConfig = useUpdateConfig(onNodeChange);
  const calculations = useMemo(() => {
    const configuredCalculations =
      (node.config.calculations as CalculationConfigEntry[] | undefined) ?? [];
    const normalized = normalizeCalculationEntries(configuredCalculations, fieldCompletions);
    return normalized.length > 0 ? normalized : [createCalculationRow()];
  }, [fieldCompletions, node.config.calculations]);
  const sourceFieldNames = useMemo(
    () => new Set(fieldCompletions.map((field) => field.toLowerCase())),
    [fieldCompletions]
  );

  const commitCalculations = useCallback(
    (next: CalculationRow[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        calculations: next.length > 0 ? next.map(persistableCalculation) : undefined,
      }));
    },
    [updateConfig]
  );

  const {
    activeItems: activeCalculations,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleKeyboardMove,
    isDragging,
    resetDrag,
    dragIndexRef,
  } = useDragReorder(calculations, commitCalculations);

  useEffect(() => {
    if (!isDragging) resetDrag();
  }, [calculations, isDragging, resetDrag]);

  function updateCalculation(index: number, patch: Partial<CalculationRow>): void {
    commitCalculations(
      activeCalculations.map((calculation, currentIndex) =>
        currentIndex === index ? { ...calculation, ...patch } : calculation
      )
    );
  }

  function updateCalculationAction(index: number, action: CalculationRow['action']): void {
    const calculation = activeCalculations[index];
    const targetIsInputField = calculation
      ? sourceFieldNames.has(calculation.field.toLowerCase())
      : false;
    const targetIsIncompatible =
      (action === 'replace' && !targetIsInputField) || (action === 'add' && targetIsInputField);
    updateCalculation(index, {
      action,
      ...(targetIsIncompatible ? { field: '' } : {}),
    });
  }

  function addCalculation(index: number): void {
    if (!canAppendRow(activeCalculations.length, MAX_CALCULATION_COUNT)) return;
    commitCalculations(insertRowAfter(activeCalculations, index, createCalculationRow()));
  }

  function copyCalculation(index: number): void {
    if (!canAppendRow(activeCalculations.length, MAX_CALCULATION_COUNT)) return;
    const source = activeCalculations[index];
    const copy = { ...source, id: createCalculationRow().id, field: '' };
    commitCalculations(insertRowAfter(activeCalculations, index, copy));
  }

  function removeCalculation(index: number): void {
    if (activeCalculations.length <= 1) {
      commitCalculations([]);
      return;
    }
    commitCalculations(activeCalculations.filter((_, currentIndex) => currentIndex !== index));
  }

  const actionOptions = [
    { value: 'add', label: tr('calcFieldActionAdd') },
    { value: 'replace', label: tr('calcFieldActionReplace') },
  ];

  const columns: GlassRowListColumn<CalculationRow>[] = [
    {
      flex: 'flex-[1]',
      header: tr('calcFieldActionHeader'),
      render: (calculation, index) => (
        <GlassOptionSingleSelect
          value={calculation.action ?? 'add'}
          groups={[{ key: 'action', items: actionOptions }]}
          onChange={(action) => updateCalculationAction(index, action as CalculationRow['action'])}
          variant="highlight"
          className="h-7 w-full text-[12px] [&>span]:text-left"
        />
      ),
    },
    {
      flex: 'flex-[1]',
      header: tr('calcFieldTargetField'),
      render: (calculation, index) => {
        const hasAddConflict =
          calculation.action !== 'replace' &&
          Boolean(calculation.field) &&
          sourceFieldNames.has(calculation.field.toLowerCase());
        return (
          <div className="flex w-full items-center gap-1">
            {calculation.action === 'replace' ? (
              <GlassFieldSingleSelect
                value={fieldCompletions.includes(calculation.field) ? calculation.field : ''}
                options={fieldCompletions}
                columnTypes={columnTypes}
                showType
                onChange={(field) => updateCalculation(index, { field })}
                placeholder={tr('calcFieldSelectPlaceholder')}
                className="h-7 w-full text-[12px]"
              />
            ) : (
              <div className="relative w-full">
                <GlassFormTextInput
                  value={calculation.field}
                  onChange={(field) => updateCalculation(index, { field })}
                  placeholder={tr('calcFieldTargetPlaceholder')}
                  className="!h-7 w-full rounded-md px-1.5 pr-6 text-[12px] shadow-none focus:ring-0"
                />
                {hasAddConflict && (
                  <span className="group absolute right-1 top-1/2 inline-flex -translate-y-1/2">
                    <AlertCircle className="h-4 w-4 text-error" />
                    <span className="invisible absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border-subtle bg-[var(--glass-card-strong)] px-2.5 py-1.5 text-[12px] text-error opacity-0 shadow-elevated backdrop-blur-xl transition-opacity group-hover:visible group-hover:opacity-100">
                      {tr('calcFieldConflictWarning')}
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>
        );
      },
    },
    {
      flex: 'flex-[2]',
      header: tr('calcFieldExpressionLabel'),
      render: (calculation, index) => (
        <CalculateFieldExpressionInput
          value={calculation.expression}
          onChange={(expression) => updateCalculation(index, { expression })}
          fieldCompletions={fieldCompletions}
          columnTypes={columnTypes}
          placeholder={tr('expression.expressionPlaceholder')}
        />
      ),
    },
  ];

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="scrollbar-hover flex-1 overflow-y-auto px-2 pr-3 pb-2 pt-1">
          <GlassRowList
            headerClassName=""
            items={activeCalculations}
            getKey={(calculation) => calculation.id}
            columns={columns}
            actions={['add', 'copy', 'remove']}
            onAdd={addCalculation}
            onCopy={copyCalculation}
            onRemove={removeCalculation}
            canAct={(action) =>
              (action !== 'add' && action !== 'copy') ||
              canAppendRow(activeCalculations.length, MAX_CALCULATION_COUNT)
            }
            draggable
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onKeyboardMove={handleKeyboardMove}
            getRowOpacity={(i) => !!(isDragging && dragIndexRef.current === i)}
            dragTitle={tr('rowList.dragToReorder')}
          />
        </div>
      </div>
    </div>
  );
}
