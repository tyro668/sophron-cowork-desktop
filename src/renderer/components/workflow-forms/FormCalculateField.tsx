import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { CalculateFieldExpressionInput } from './calculate-field/CalculateFieldExpressionInput';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassRowList, type GlassRowListColumn } from './shared/GlassRowList';
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
  const tr = useFormTranslation();
  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });
  const updateConfig = useUpdateConfig(onNodeChange);
  const rawCalculations = useMemo(
    () => (node.config.calculations as CalculationConfigEntry[] | undefined) ?? [],
    [node.config.calculations]
  );
  const [calculations, setCalculations] = useState<CalculationRow[]>(() =>
    normalizeCalculationEntries(rawCalculations, fieldCompletions)
  );
  const sourceFieldNames = useMemo(
    () => new Set(fieldCompletions.map((field) => field.toLowerCase())),
    [fieldCompletions]
  );

  const storeCalculations = useCallback(
    (next: CalculationRow[]) => {
      updateConfig(() => ({
        calculations: next.length > 0 ? next.map(persistableCalculation) : undefined,
      }));
    },
    [updateConfig]
  );

  const changeCalculations = useCallback(
    (next: CalculationRow[]) => {
      setCalculations(next);
      storeCalculations(next);
    },
    [storeCalculations]
  );

  const {
    activeItems: activeCalculations,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    isDragging,
    resetDrag,
    dragIndexRef,
  } = useDragReorder(calculations, changeCalculations);

  useEffect(() => {
    if (!isDragging) resetDrag();
  }, [calculations, isDragging, resetDrag]);

  useEffect(() => {
    const normalized = normalizeCalculationEntries(rawCalculations, fieldCompletions);
    setCalculations(normalized);
  }, [fieldCompletions, rawCalculations]);

  function updateCalculation(index: number, patch: Partial<CalculationRow>): void {
    if (!activeCalculations[index]) {
      changeCalculations([{ ...createCalculationRow(), ...patch }]);
      return;
    }
    changeCalculations(
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
    const next = [...activeCalculations];
    next.splice(index + 1, 0, createCalculationRow());
    changeCalculations(next);
  }

  function copyCalculation(index: number): void {
    const source = activeCalculations[index];
    const copy = { ...source, id: createCalculationRow().id, field: '' };
    const next = [...activeCalculations];
    next.splice(index + 1, 0, copy);
    changeCalculations(next);
  }

  function removeCalculation(index: number): void {
    changeCalculations(activeCalculations.filter((_, currentIndex) => currentIndex !== index));
  }

  const visibleCalculations =
    activeCalculations.length > 0 ? activeCalculations : [createCalculationRow()];
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
          className="h-7 w-full text-[12px] [&>span]:text-left"
        />
      ),
    },
    {
      flex: 'flex-[2]',
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
      flex: 'flex-[4]',
      header: tr('calcFieldExpressionLabel'),
      render: (calculation, index) => (
        <CalculateFieldExpressionInput
          value={calculation.expression}
          onChange={(expression) => updateCalculation(index, { expression })}
          fieldCompletions={fieldCompletions}
          columnTypes={columnTypes}
          placeholder={tr('expressionPlaceholder')}
        />
      ),
    },
  ];

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-2 pr-3 pb-2 pt-1">
          <GlassRowList
            headerClassName=""
            items={visibleCalculations}
            columns={columns}
            actions={['add', 'copy', 'remove']}
            onAdd={addCalculation}
            onCopy={copyCalculation}
            onRemove={removeCalculation}
            canAct={(action) =>
              (action !== 'remove' && action !== 'copy') || calculations.length > 0
            }
            draggable
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            getRowOpacity={(i) => !!(isDragging && dragIndexRef.current === i)}
            dragTitle={tr('dragToReorder')}
          />
        </div>
      </div>
    </div>
  );
}
