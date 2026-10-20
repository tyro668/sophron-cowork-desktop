import { useCallback, useMemo } from 'react';
import { useFormTranslation } from '../../../hooks/useFormTranslation';
import {
  GlassExpressionInput,
  type ExpressionAssistantPanel,
  type GlassExpressionInputProps,
} from '../shared/GlassExpressionInput';
import { parseCalculationFunctionWizardInput } from '../../../../shared/calculate-field/wizard-input';
import { CalculationFunctionWizard } from './CalculationFunctionWizard';
import { normalizeCalculationDomainExpression } from '../../../../shared/calculate-field/domain-dsl';

export const CALC_WIZARD_GRID_COLUMNS = '150px 190px 104px minmax(0,1fr) 112px 112px 44px';

type CalculateFieldExpressionInputProps = Omit<GlassExpressionInputProps, 'assistantPanel'>;

export function CalculateFieldExpressionInput({
  fieldCompletions,
  columnTypes,
  onChange,
  ...expressionInputProps
}: CalculateFieldExpressionInputProps) {
  const tr = useFormTranslation('calculateField');
  const commitExpression = useCallback(
    (expression: string) => {
      let normalized = expression;
      try {
        normalized = normalizeCalculationDomainExpression(expression, { allowLegacySql: true });
      } catch {
        // Keep incomplete drafts editable; workflow validation reports their errors.
      }
      onChange(normalized);
    },
    [onChange]
  );
  const assistantPanel = useMemo<ExpressionAssistantPanel>(
    () => ({
      openLabel: tr('calcFieldOpenWizard'),
      closeLabel: tr('calcFieldCloseWizard'),
      gridColumns: CALC_WIZARD_GRID_COLUMNS,
      titleSpan: 4,
      render: ({ currentExpression, insertExpression, replaceExpression, footerOverride }) => {
        const initialInput = parseCalculationFunctionWizardInput(currentExpression);
        return (
          <CalculationFunctionWizard
            key={initialInput ? currentExpression : 'new-calculation-function'}
            fieldCompletions={fieldCompletions}
            columnTypes={columnTypes}
            initialInput={initialInput}
            currentExpression={currentExpression}
            onInsertAtCursor={insertExpression}
            onReplace={replaceExpression}
            footerOverride={footerOverride}
            tr={tr}
          />
        );
      },
    }),
    [columnTypes, fieldCompletions, tr]
  );

  return (
    <GlassExpressionInput
      {...expressionInputProps}
      onChange={commitExpression}
      fieldCompletions={fieldCompletions}
      columnTypes={columnTypes}
      assistantPanel={assistantPanel}
      title={expressionInputProps.title ?? tr('calcFieldEditorTitle')}
    />
  );
}
