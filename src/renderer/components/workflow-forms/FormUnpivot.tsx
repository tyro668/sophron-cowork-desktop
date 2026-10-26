import { useMemo } from 'react';
import { Info } from 'lucide-react';
import type { OperatorFormProps } from './types';
import { FieldPatternCells } from './shared/FieldPatternCells';
import { GlassOptionMultiSelect } from './shared/GlassOptionMultiSelect';
import {
  Cell,
  ErrorRow,
  FormGrid,
  FormScroll,
  GlassCommitTextInput,
  HintRow,
  LabelCell,
  SelectCell,
} from './shared/FormGrid';
import { UNPIVOT_GRID_COLUMNS } from './shared/gridColumns';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';

export default function FormUnpivot({
  node,
  pipelineId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('unpivot');
  const updateConfig = useUpdateConfig(onNodeChange);
  const columnTypes = useWorkflowNodeColumnTypes({ pipelineId, sourceNode });

  const mode = (node.config.selection as string) ?? 'include';
  const nameColumn = (node.config.nameColumn as string) ?? '';
  const valueColumn = (node.config.valueColumn as string) ?? '';
  const includeNulls = !!node.config.includeNulls;
  const rawColumns = useMemo(() => (node.config.fields as string[]) ?? [], [node.config.fields]);

  const columns = useMemo(
    () =>
      mode === 'exclude'
        ? fieldCompletions.filter((c) => !rawColumns.includes(c))
        : // Keep configured columns even when unresolved — the picker flags
          // them as missing/pending instead of silently dropping the config.
          rawColumns,
    [mode, rawColumns, fieldCompletions]
  );

  const kept = fieldCompletions.filter((f) => !columns.includes(f));
  const { nameError, valueError } = validateUnpivotNames(nameColumn, valueColumn, kept);
  const outputColumns = [...kept, nameColumn.trim() || 'Name', valueColumn.trim() || 'Value'];

  return (
    <FormScroll>
      <FormGrid columns={UNPIVOT_GRID_COLUMNS} testId="unpivot-form-grid">
        <LabelCell required>{tr('unpivotDimensionsLabel')}</LabelCell>
        <Cell span={3} v={['ctl', 'chips', columns.length === 0 && 'err']}>
          <GlassOptionMultiSelect
            options={fieldCompletions}
            selected={columns}
            onChange={(selected) =>
              updateConfig((cfg) => ({ ...cfg, selection: 'include', fields: selected }))
            }
            optionTypes={columnTypes}
            placeholder={tr('common.selectColumns')}
            maxHeight="300px"
            className="w-full"
          />
        </Cell>

        <LabelCell>{tr('fieldPattern.ruleLabel')}</LabelCell>
        <FieldPatternCells
          fields={fieldCompletions}
          columnTypes={columnTypes}
          patternSpan={2}
          onApply={(matched) =>
            updateConfig((cfg) => ({
              ...cfg,
              selection: 'include',
              fields: [...columns, ...matched.filter((field) => !columns.includes(field))],
            }))
          }
        />
        <LabelCell>{tr('unpivotNameCol')}</LabelCell>
        <Cell span={2} v={['ctl', Boolean(nameError) && 'err']}>
          <GlassCommitTextInput
            value={nameColumn}
            onCommit={(v) => updateConfig((cfg) => ({ ...cfg, nameColumn: v.trim() }))}
            placeholder="Name"
            ariaLabel={tr('unpivotNameCol')}
            ariaInvalid={Boolean(nameError)}
          />
        </Cell>
        <Cell v={['muted']}>{tr('unpivotNameColTip')}</Cell>
        {nameError && (
          <>
            <Cell v={['lab']} />
            <ErrorRow span={3}>{tr(nameError, { name: nameColumn.trim() })}</ErrorRow>
          </>
        )}

        <LabelCell>{tr('unpivotValueCol')}</LabelCell>
        <Cell span={2} v={['ctl', Boolean(valueError) && 'err']}>
          <GlassCommitTextInput
            value={valueColumn}
            onCommit={(v) => updateConfig((cfg) => ({ ...cfg, valueColumn: v.trim() }))}
            placeholder="Value"
            ariaLabel={tr('unpivotValueCol')}
            ariaInvalid={Boolean(valueError)}
          />
        </Cell>
        <Cell v={['muted']}>{tr('unpivotValueColTip')}</Cell>
        {valueError && (
          <>
            <Cell v={['lab']} />
            <ErrorRow span={3}>{tr(valueError, { name: valueColumn.trim() || 'Value' })}</ErrorRow>
          </>
        )}

        <LabelCell>{tr('unpivotNullsLabel')}</LabelCell>
        <SelectCell
          value={includeNulls ? 'include' : 'skip'}
          options={[
            {
              value: 'skip',
              label: tr('unpivotSkipNulls'),
              description: tr('unpivotSkipNullsTip'),
            },
            {
              value: 'include',
              label: tr('unpivotIncludeNulls'),
              description: tr('unpivotIncludeNullsTip'),
            },
          ]}
          onChange={(v) => updateConfig((cfg) => ({ ...cfg, includeNulls: v === 'include' }))}
          ariaLabel={tr('unpivotNullsLabel')}
        />
        <Cell v={['blank']} />

        <HintRow span={4}>
          <Info className="opg-ic h-3.5 w-3.5" />
          {tr('unpivotOutputPreview', {
            cols: outputColumns.join(' · '),
            count: columns.length,
          })}
        </HintRow>
      </FormGrid>
    </FormScroll>
  );
}

/** Name / value columns must differ from each other and from kept columns. */
export function validateUnpivotNames(
  nameColumn: string,
  valueColumn: string,
  keptColumns: string[]
): { nameError?: string; valueError?: string } {
  const name = (nameColumn.trim() || 'Name').toLowerCase();
  const value = (valueColumn.trim() || 'Value').toLowerCase();
  const kept = new Set(keptColumns.map((c) => c.toLowerCase()));
  return {
    nameError: kept.has(name) ? 'unpivotErrKeptConflict' : undefined,
    valueError:
      name === value
        ? 'unpivotErrSameName'
        : kept.has(value)
          ? 'unpivotErrKeptConflict'
          : undefined,
  };
}
