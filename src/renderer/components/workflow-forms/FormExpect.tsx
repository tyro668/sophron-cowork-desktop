import { useCallback, useEffect, useMemo, useState } from 'react';

import type { OperatorFormProps } from './types';
import { GlassExpressionInput } from './shared/GlassExpressionInput';
import { GlassOptionMultiSelect } from './shared/GlassOptionMultiSelect';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import {
  Cell,
  ErrorRow,
  FormGrid,
  FormScroll,
  GlassCommitTextInput,
  LabelCell,
  SegmentCells,
} from './shared/FormGrid';
import { EXPECT_GRID_COLUMNS } from './shared/gridColumns';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';

type ExpectKind = 'expression' | 'unique' | 'row_count';
const ROW_OPERATORS = [
  { op: '>', sym: '>', key: 'gt' },
  { op: '>=', sym: '≥', key: 'gte' },
  { op: '=', sym: '=', key: 'eq' },
  { op: '!=', sym: '≠', key: 'ne' },
  { op: '<=', sym: '≤', key: 'lte' },
  { op: '<', sym: '<', key: 'lt' },
] as const;

function parseThreshold(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : undefined;
}

export default function FormExpect({
  node,
  pipelineId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('expect');
  const columnTypes = useWorkflowNodeColumnTypes({ pipelineId, sourceNode });
  const updateConfig = useUpdateConfig(onNodeChange);

  const kind: ExpectKind =
    node.config?.kind === 'unique'
      ? 'unique'
      : node.config?.kind === 'row_count'
        ? 'row_count'
        : 'expression';
  const expression = (node.config?.expression as string) ?? '';
  const columns = useMemo(() => (node.config?.columns as string[]) ?? [], [node.config?.columns]);
  const operator = (node.config?.operator as string) ?? '>=';
  const value = node.config?.value as number | undefined;
  const committedValue = value === undefined || value === null ? '' : String(value);
  // Keep the raw text locally so an invalid entry stays visible with an error
  // instead of being silently cleared.
  const [rawValue, setRawValue] = useState(committedValue);
  useEffect(() => {
    setRawValue((prev) => (parseThreshold(prev) === value ? prev : committedValue));
  }, [committedValue, value]);
  const valueInvalid = rawValue.trim() !== '' && parseThreshold(rawValue) === undefined;
  const rejectStream = (node.config?.rejectStream as string) ?? '';

  const setKind = useCallback(
    (next: ExpectKind) => {
      updateConfig((cfg) =>
        next === 'row_count'
          ? { ...cfg, kind: next, rejectStream: undefined }
          : { ...cfg, kind: next }
      );
    },
    [updateConfig]
  );

  const commitColumns = useCallback(
    (next: string[]) => {
      updateConfig((cfg) => ({ ...cfg, columns: next.length > 0 ? next : undefined }));
    },
    [updateConfig]
  );

  return (
    <FormScroll>
      <FormGrid columns={EXPECT_GRID_COLUMNS} testId="expect-form-grid">
        <LabelCell>{tr('expect.kind.label')}</LabelCell>
        <SegmentCells
          value={kind}
          options={[
            { value: 'expression', label: tr('expect.kind.expression') },
            { value: 'unique', label: tr('expect.kind.unique') },
            { value: 'row_count', label: tr('expect.kind.rowCount') },
          ]}
          onChange={setKind}
          ariaLabel={tr('expect.kind.label')}
        />
        <Cell span={2} v={['blank']} />

        {kind === 'expression' && (
          <>
            <LabelCell>{tr('expect.expression.label')}</LabelCell>
            <Cell span={5} v={['ctl', !expression.trim() && 'err']}>
              <GlassExpressionInput
                value={expression}
                onChange={(next) =>
                  updateConfig((cfg) => ({ ...cfg, expression: next || undefined }))
                }
                fieldCompletions={fieldCompletions}
                columnTypes={columnTypes}
                placeholder={tr('expect.expression.placeholder')}
              />
            </Cell>
          </>
        )}

        {kind === 'unique' && (
          <>
            <LabelCell>{tr('expect.unique.label')}</LabelCell>
            <Cell span={5} v={['ctl', 'chips', columns.length === 0 && 'err']}>
              <GlassOptionMultiSelect
                options={fieldCompletions}
                selected={columns}
                onChange={commitColumns}
                placeholder={tr('expect.unique.placeholder')}
                optionTypes={columnTypes}
                className="w-full"
              />
            </Cell>
          </>
        )}

        {kind === 'row_count' && (
          <>
            <LabelCell>{tr('expect.rows.label')}</LabelCell>
            <Cell span={2} v={['ctl']}>
              <GlassOptionSingleSelect
                value={operator}
                groups={[
                  {
                    key: 'operator',
                    items: ROW_OPERATORS.map((o) => ({
                      value: o.op,
                      label: `${o.sym} ${tr(`expect.ops.${o.key}`)}`,
                    })),
                  },
                ]}
                onChange={(op) => updateConfig((cfg) => ({ ...cfg, operator: op }))}
                className="h-full w-full"
              />
            </Cell>
            <Cell span={2} v={['ctl', valueInvalid && 'err']}>
              <GlassCommitTextInput
                value={rawValue}
                onDraftChange={setRawValue}
                onCommit={(raw) => {
                  setRawValue(raw);
                  const n = parseThreshold(raw);
                  updateConfig((cfg) => ({ ...cfg, value: n }));
                }}
                ariaLabel={tr('expect.rows.valueLabel')}
                ariaInvalid={valueInvalid}
                placeholder="0"
              />
            </Cell>
            <Cell v={['muted', 'ctr']}>{tr('expect.rows.unit')}</Cell>
            {valueInvalid && (
              <>
                <Cell v={['lab']} />
                <ErrorRow span={5}>{tr('expect.rows.invalid')}</ErrorRow>
              </>
            )}
          </>
        )}

        {/* Row-count assertions have no per-row violations, so the reject
            stream is shown (layout parity) but disabled for that kind. */}
        <LabelCell>{tr('expect.reject.label')}</LabelCell>
        <Cell span={5} v={['ctl']}>
          <GlassCommitTextInput
            value={rejectStream}
            onCommit={(raw) =>
              updateConfig((cfg) => ({ ...cfg, rejectStream: raw.trim() || undefined }))
            }
            ariaLabel={tr('expect.reject.label')}
            placeholder={tr('expect.reject.placeholder')}
            className="font-mono"
            disabled={kind === 'row_count'}
          />
        </Cell>
      </FormGrid>
    </FormScroll>
  );
}
