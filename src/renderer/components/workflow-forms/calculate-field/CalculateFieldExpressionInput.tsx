import { useMemo } from 'react';
import { useFormTranslation } from '../../../hooks/useFormTranslation';
import {
  GlassExpressionInput,
  type ExpressionAssistantPanel,
  type GlassExpressionInputProps,
} from '../shared/GlassExpressionInput';
import { CalculationFunctionWizard } from './CalculationFunctionWizard';
import { CALCULATE_FIELD_EXPRESSION_FUNCTION_GROUPS } from './expression-function-groups';

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
      render: ({ insertExpression, closePanel }) => (
        <CalculationFunctionWizard
          fieldCompletions={fieldCompletions}
          columnTypes={columnTypes}
          onInsert={(expression) => {
            insertExpression(expression);
            closePanel();
          }}
          tr={tr}
        />
      ),
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
