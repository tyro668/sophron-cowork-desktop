import { useCallback, useMemo } from 'react';
import { useFormTranslation } from '../../../hooks/useFormTranslation';
import {
  GlassExpressionInput,
  type ExpressionAssistantPanel,
  type GlassExpressionInputProps,
} from '../shared/GlassExpressionInput';
import { parseCalculationFunctionWizardInput } from '../../../../shared/calculate-field/wizard-input';
import { CalculationFunctionWizard } from './CalculationFunctionWizard';
import {
  expandCalculationDomainExpression,
  normalizeCalculationDomainExpression,
} from '../../../../shared/calculate-field/domain-dsl';

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

  const expandExpression = useCallback(
    (expression: string) => expandCalculationDomainExpression(expression, { allowLegacySql: true }),
    []
  );

  return (
    <GlassExpressionInput
      {...expressionInputProps}
      onChange={commitExpression}
      fieldCompletions={fieldCompletions}
      columnTypes={columnTypes}
      assistantPanel={assistantPanel}
      aggregateContext="row"
      expandExpression={expandExpression}
      title={expressionInputProps.title ?? tr('calcFieldEditorTitle')}
    />
  );
}
