import { useCallback, useMemo } from 'react';

import type { OperatorFormProps } from './index';
import { GlassFieldMultiDropdown } from './shared/GlassFieldMultiDropdown';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassOptionSingleSelect } from './shared/GlassOptionSingleSelect';
import { GlassSegmentedControl } from './shared/GlassSegmentedControl';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';

type ExpectKind = 'expression' | 'unique' | 'row_count';
const ROW_OPERATORS = ['>', '>=', '=', '!=', '<=', '<'] as const;

export default function FormExpect({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('expect');
  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });
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
  const rejectStream = (node.config?.rejectStream as string) ?? '';

  const setKind = useCallback(
    (next: ExpectKind) => {
      updateConfig((cfg) => ({ ...cfg, kind: next }));
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
    <div className="scrollbar-hover h-full min-h-0 overflow-y-auto p-3">
      <div className="space-y-3">
        <div>
          <GlassFormLabel>{tr('kind.label')}</GlassFormLabel>
          <GlassSegmentedControl
            value={kind}
            options={[
              { value: 'expression', label: tr('kind.expression') },
              { value: 'unique', label: tr('kind.unique') },
              { value: 'row_count', label: tr('kind.rowCount') },
            ]}
            onChange={setKind}
            ariaLabel={tr('kind.label')}
          />
        </div>

        {kind === 'expression' && (
          <div>
            <GlassFormLabel>{tr('expression.label')}</GlassFormLabel>
            <GlassFormTextInput
              value={expression}
              onChange={(value) =>
                updateConfig((cfg) => ({ ...cfg, expression: value || undefined }))
              }
              placeholder={tr('expression.placeholder')}
              className="w-full font-mono"
            />
          </div>
        )}

        {kind === 'unique' && (
          <div>
            <GlassFormLabel>{tr('unique.label')}</GlassFormLabel>
            <GlassFieldMultiDropdown
              columns={fieldCompletions}
              selected={columns}
              onChange={commitColumns}
              placeholder={tr('unique.placeholder')}
              columnTypes={columnTypes}
              className="w-full"
            />
          </div>
        )}

        {kind === 'row_count' && (
          <div className="flex items-end gap-2">
            <div className="w-28">
              <GlassFormLabel>{tr('rows.operatorLabel')}</GlassFormLabel>
              <GlassOptionSingleSelect
                value={operator}
                groups={[
                  {
                    key: 'operator',
                    items: ROW_OPERATORS.map((op) => ({ value: op, label: op })),
                  },
                ]}
                onChange={(op) => updateConfig((cfg) => ({ ...cfg, operator: op }))}
                className="h-8 w-full"
              />
            </div>
            <div className="min-w-0 flex-1">
              <GlassFormLabel>{tr('rows.valueLabel')}</GlassFormLabel>
              <GlassFormTextInput
                value={value === undefined || value === null ? '' : String(value)}
                onChange={(raw) => {
                  const trimmed = raw.trim();
                  const n = Number(trimmed);
                  updateConfig((cfg) => ({
                    ...cfg,
                    value: trimmed !== '' && Number.isSafeInteger(n) && n >= 0 ? n : undefined,
                  }));
                }}
                inputMode="numeric"
                placeholder="0"
                className="w-full"
              />
            </div>
          </div>
        )}

        <div>
          <GlassFormLabel>{tr('reject.label')}</GlassFormLabel>
          <GlassFormTextInput
            value={rejectStream}
            onChange={(raw) =>
              updateConfig((cfg) => ({
                ...cfg,
                rejectStream: raw.trim() || undefined,
              }))
            }
            placeholder={tr('reject.placeholder')}
            className="w-full font-mono"
          />
        </div>
      </div>
    </div>
  );
}
