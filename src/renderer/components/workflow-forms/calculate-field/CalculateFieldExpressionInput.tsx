import { useMemo } from 'react';
import { useFormTranslation } from '../../../hooks/useFormTranslation';
import {
  GlassExpressionInput,
  type ExpressionAssistantPanel,
  type GlassExpressionInputProps,
} from '../shared/GlassExpressionInput';
import { CalculationFunctionWizard } from './CalculationFunctionWizard';
import { CALCULATE_FIELD_EXPRESSION_FUNCTION_GROUPS } from './expression-function-groups';
import { parseCalculationFunctionWizardInput } from './wizard-input';

type CalculateFieldExpressionInputProps = Omit<GlassExpressionInputProps, 'assistantPanel'>;

export function CalculateFieldExpressionInput({
  fieldCompletions,
  columnTypes,
  ...expressionInputProps
}: CalculateFieldExpressionInputProps) {
  const tr = useFormTranslation();
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
      fieldCompletions={fieldCompletions}
      columnTypes={columnTypes}
      functionGroups={CALCULATE_FIELD_EXPRESSION_FUNCTION_GROUPS}
      assistantPanel={assistantPanel}
    />
  );
}
