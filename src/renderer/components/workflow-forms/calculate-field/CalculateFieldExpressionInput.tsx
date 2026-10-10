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
      render: ({ currentExpression, replaceExpression, closePanel }) => {
        const initialInput = parseCalculationFunctionWizardInput(currentExpression);
        return (
          <CalculationFunctionWizard
            key={initialInput ? currentExpression : 'new-calculation-function'}
            fieldCompletions={fieldCompletions}
            columnTypes={columnTypes}
            initialInput={initialInput}
            onInsert={(expression) => {
              replaceExpression(expression);
              closePanel();
            }}
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
    />
  );
}
