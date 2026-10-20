import { Fragment, useCallback, useMemo } from 'react';
import type { OperatorFormProps } from './types';
import { CalculateFieldExpressionInput } from './calculate-field/CalculateFieldExpressionInput';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import {
  AddRow,
  Cell,
  ErrorRow,
  FormGrid,
  FormScroll,
  GlassCommitTextInput,
  GridRow,
  RowActionsCell,
  SegmentCells,
} from './shared/FormGrid';
import { CALCULATE_FIELD_GRID_COLUMNS } from './shared/gridColumns';
import { useGridRowDrag } from './shared/useGridRowDrag';
import { lintExpression } from './shared/expressionLint';
import { canAppendRow, insertRowAfter, patchRowAt } from './shared/rowListOperations';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
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
  pipelineId,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('calculateField');
  const columnTypes = useWorkflowNodeColumnTypes({ pipelineId, sourceNode });
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
    rowProps,
    dragHandle,
  } = useGridRowDrag(calculations, commitCalculations);

  function updateCalculation(index: number, patch: Partial<CalculationRow>): void {
    updateConfig((cfg) => {
      // Patch the raw persisted rows first (reusing rendered ids), then normalize.
      const current = (cfg.calculations as CalculationConfigEntry[] | undefined) ?? [];
      const patched = patchRowAt<CalculationConfigEntry>(current, activeCalculations, index, patch);
      return {
        ...cfg,
        calculations: normalizeCalculationEntries(patched, fieldCompletions).map(
          persistableCalculation
        ),
      };
    });
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

  const canAdd = canAppendRow(activeCalculations.length, MAX_CALCULATION_COUNT);
  const rowLabels = {
    add: tr('calcFieldAddRow'),
    copy: tr('rowList.copyRow'),
    remove: tr('calcFieldRemoveRow'),
    drag: tr('rowList.dragToReorder'),
  };
  const issues = validateCalculationRows(activeCalculations, fieldCompletions);

  return (
    <FormScroll>
      <FormGrid columns={CALCULATE_FIELD_GRID_COLUMNS} testId="calculate-field-form-grid">
        <Cell span={2} v={['th']}>
          {tr('calcFieldActionHeader')}
        </Cell>
        <Cell v={['th']}>{tr('calcFieldTargetField')}</Cell>
        <Cell v={['th']}>{tr('calcFieldExpressionLabel')}</Cell>
        <Cell v={['th']} />
        {activeCalculations.map((calculation, index) => {
          const issue = issues[index];
          const messages: string[] = [];
          if (issue.duplicateOf !== undefined)
            messages.push(
              tr('calcFieldDuplicateTarget', {
                field: calculation.field,
                row: issue.duplicateOf + 1,
              })
            );
          if (issue.upstreamConflict)
            messages.push(tr('calcFieldUpstreamConflict', { field: calculation.field }));
          if (issue.formulaIssues > 0)
            messages.push(tr('calcFieldFormulaIssues', { count: issue.formulaIssues }));
          const targetErr = issue.duplicateOf !== undefined || issue.upstreamConflict;
          return (
            <Fragment key={calculation.id}>
              <GridRow {...rowProps(index)} testId={`calculate-field-row-${index}`}>
                <SegmentCells
                  value={calculation.action === 'replace' ? 'replace' : 'add'}
                  options={[
                    { value: 'add', label: tr('calcFieldActionAdd') },
                    { value: 'replace', label: tr('calcFieldActionReplace') },
                  ]}
                  onChange={(action) => updateCalculationAction(index, action)}
                  ariaLabel={tr('calcFieldActionHeader')}
                />
                {calculation.action === 'replace' ? (
                  <Cell v={['ctl', targetErr && 'err']}>
                    <GlassFieldSingleSelect
                      value={calculation.field}
                      options={fieldCompletions}
                      columnTypes={columnTypes}
                      onChange={(field) => updateCalculation(index, { field })}
                      placeholder={tr('calcFieldSelectPlaceholder')}
                      className="w-full"
                    />
                  </Cell>
                ) : (
                  <Cell v={['ctl', targetErr && 'err']}>
                    <GlassCommitTextInput
                      value={calculation.field}
                      onCommit={(field) => updateCalculation(index, { field: field.trim() })}
                      placeholder={tr('calcFieldTargetPlaceholder')}
                      ariaLabel={tr('calcFieldTargetField')}
                      ariaInvalid={targetErr}
                    />
                  </Cell>
                )}
                <Cell v={['ctl', issue.formulaIssues > 0 && 'err']}>
                  <CalculateFieldExpressionInput
                    subtitle={tr('calcFieldEditorSubtitle', { index: index + 1 })}
                    value={calculation.expression}
                    onChange={(expression) => updateCalculation(index, { expression })}
                    fieldCompletions={fieldCompletions}
                    columnTypes={columnTypes}
                    lintFields={[
                      ...fieldCompletions,
                      ...activeCalculations
                        .slice(0, index)
                        .map((row) => row.field.trim())
                        .filter(Boolean),
                    ]}
                    placeholder={tr('expression.expressionPlaceholder')}
                  />
                </Cell>
                <RowActionsCell
                  labels={rowLabels}
                  onAdd={() => addCalculation(index)}
                  onCopy={() => copyCalculation(index)}
                  onRemove={() => removeCalculation(index)}
                  canAdd={canAdd}
                  dragHandle={dragHandle(index)}
                />
              </GridRow>
              {messages.length > 0 ? (
                <ErrorRow span={5}>
                  <b>{tr('rowPrefix', { index: index + 1 })}</b>
                  {messages.join(tr('calcFieldMessageSeparator')) + tr('calcFieldMessageEnd')}
                </ErrorRow>
              ) : null}
            </Fragment>
          );
        })}
        <AddRow
          span={5}
          label={tr('calcFieldAddRow')}
          onClick={() => addCalculation(activeCalculations.length - 1)}
          disabled={!canAdd}
        />
      </FormGrid>
    </FormScroll>
  );
}

export interface CalculationRowIssue {
  /** Index of the earlier row with the same target field. */
  duplicateOf?: number;
  /** A new field ("add") whose name already exists upstream. */
  upstreamConflict: boolean;
  /** Live-lint issues in the formula (unknown fields, unbalanced brackets). */
  formulaIssues: number;
}

export function validateCalculationRows(
  rows: Array<Pick<CalculationRow, 'field' | 'expression' | 'action'>>,
  upstreamFields: string[]
): CalculationRowIssue[] {
  const upstream = new Set(upstreamFields.map((f) => f.toLowerCase()));
  const seen = new Map<string, number>();
  const known = [...upstreamFields];
  return rows.map((row, index) => {
    // Formulas may reference fields created by earlier rows.
    const knownForRow = [...known];
    if (row.field.trim()) known.push(row.field.trim());
    const key = row.field.trim().toLowerCase();
    let duplicateOf: number | undefined;
    if (key) {
      if (seen.has(key)) duplicateOf = seen.get(key);
      else seen.set(key, index);
    }
    return {
      duplicateOf,
      upstreamConflict: row.action !== 'replace' && Boolean(key) && upstream.has(key),
      formulaIssues: row.expression.trim() ? lintExpression(row.expression, knownForRow).length : 0,
    };
  });
}
