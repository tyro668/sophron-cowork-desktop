import type { ComponentProps } from 'react';
import { Cell, GlassCommitTextInput } from './FormGrid';
import { GlassOptionSingleSelect } from './GlassOptionSingleSelect';
import { MetricExpressionCell } from './MetricExpressionCell';
import type { MetricRowIssue } from './metricValidation';

interface MetricValueCellsProps {
  metric: { function: string; expression?: string; alias?: string };
  issue: MetricRowIssue;
  functionGroups: ComponentProps<typeof GlassOptionSingleSelect>['groups'];
  fieldCompletions: string[];
  columnTypes?: Record<string, string>;
  expressionPlaceholder: string;
  aliasPlaceholder: string;
  aliasLabel: string;
  onFunctionChange: (value: string) => void;
  onExpressionChange: (expression: string) => void;
  onAliasChange: (alias: string) => void;
}

export function MetricValueCells({
  metric,
  issue,
  functionGroups,
  fieldCompletions,
  columnTypes,
  expressionPlaceholder,
  aliasPlaceholder,
  aliasLabel,
  onFunctionChange,
  onExpressionChange,
  onAliasChange,
}: MetricValueCellsProps) {
  return (
    <>
      <Cell v={['ctl']}>
        <GlassOptionSingleSelect
          value={metric.function}
          groups={functionGroups}
          onChange={onFunctionChange}
          className="w-full"
        />
      </Cell>
      <Cell v={['ctl', issue.expressionError && 'err']}>
        <MetricExpressionCell
          value={metric.expression ?? ''}
          onChange={onExpressionChange}
          fieldCompletions={fieldCompletions}
          columnTypes={columnTypes}
          allowAllRows={metric.function === 'count'}
          placeholder={expressionPlaceholder}
        />
      </Cell>
      <Cell v={['ctl', issue.aliasError && 'err']}>
        <GlassCommitTextInput
          value={metric.alias ?? ''}
          onCommit={(value) => onAliasChange(value.trim())}
          placeholder={aliasPlaceholder}
          ariaLabel={aliasLabel}
          ariaInvalid={issue.aliasError}
          className="h-full w-full px-2.5 text-ui-body"
        />
      </Cell>
    </>
  );
}
