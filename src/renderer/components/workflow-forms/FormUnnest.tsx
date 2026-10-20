import type { OperatorFormProps } from './types';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import {
  Cell,
  ErrorRow,
  FormGrid,
  FormScroll,
  GlassCommitTextInput,
  LabelCell,
  SegmentCells,
} from './shared/FormGrid';
import { UNNEST_GRID_COLUMNS } from './shared/gridColumns';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';

export default function FormUnnest({
  node,
  pipelineId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('unnest');
  const updateConfig = useUpdateConfig(onNodeChange);
  const columnTypes = useWorkflowNodeColumnTypes({ pipelineId, sourceNode });

  const sourceKind = (node.config.sourceKind as 'list' | 'json') ?? 'list';
  const field = (node.config.column as string) ?? '';
  const alias = (node.config.alias as string) ?? '';
  const path = (node.config.path as string) ?? '$';
  const withIndex = node.config.withIndex as string | undefined;
  const keepParentNames = !!node.config.keepParentNames;
  const preserveOrder = !!node.config.preserveOrder;
  const isListMode = sourceKind === 'list';
  const hasIndexColumn = typeof withIndex === 'string';
  const aliasMissing = isListMode && alias.trim().length === 0;
  const indexMissing = isListMode && hasIndexColumn && withIndex.trim().length === 0;

  return (
    <FormScroll>
      <FormGrid columns={UNNEST_GRID_COLUMNS} testId="unnest-form-grid">
        <LabelCell>{tr('unnestSourceType')}</LabelCell>
        <SegmentCells
          value={sourceKind}
          ariaLabel={tr('unnestSourceType')}
          options={[
            { value: 'list', label: tr('unnestSourceTypeList') },
            { value: 'json', label: tr('unnestSourceTypeObject') },
          ]}
          onChange={(value) => updateConfig((cfg) => ({ ...cfg, sourceKind: value }))}
        />
        <Cell v={['muted']}>
          {isListMode ? tr('unnestSourceTypeListTip') : tr('unnestSourceTypeJsonTip')}
        </Cell>

        <LabelCell required>{tr('unnestSourceField')}</LabelCell>
        <Cell span={3} v={['ctl']}>
          <GlassFieldSingleSelect
            value={field}
            options={fieldCompletions}
            columnTypes={columnTypes}
            onChange={(v) => updateConfig((cfg) => ({ ...cfg, column: v }))}
            placeholder={tr('unnestSelectField')}
            searchPlaceholder={tr('fieldPicker.searchField')}
            emptyText={tr('fieldPicker.noMatch')}
            className="w-full"
          />
        </Cell>

        {isListMode ? (
          <>
            <LabelCell required>{tr('unnestAlias')}</LabelCell>
            <Cell span={2} v={['ctl', aliasMissing && 'err']}>
              <GlassCommitTextInput
                value={alias}
                // Clearing must clear the config too — previously the old alias
                // was silently kept while the input looked empty.
                onCommit={(v) => updateConfig((cfg) => ({ ...cfg, alias: v.trim() || undefined }))}
                placeholder={tr('unnestAliasPlaceholder')}
                ariaLabel={tr('unnestAlias')}
                ariaInvalid={aliasMissing}
              />
            </Cell>
            <Cell v={['muted']}>{tr('unnestAliasTip')}</Cell>
            {aliasMissing ? (
              <>
                <Cell v={['lab']} />
                <ErrorRow span={3}>{tr('unnestAliasRequired')}</ErrorRow>
              </>
            ) : null}
          </>
        ) : null}

        <LabelCell>{tr('unnestPathLabel')}</LabelCell>
        <Cell span={2} v={['ctl']}>
          <GlassCommitTextInput
            value={path}
            onCommit={(v) => updateConfig((cfg) => ({ ...cfg, path: v.trim() || '$' }))}
            placeholder={tr('unnestPathPlaceholder')}
            ariaLabel={tr('unnestPathLabel')}
            className="font-mono"
          />
        </Cell>
        <Cell v={['muted']}>{tr('unnestPathTip')}</Cell>

        {isListMode ? (
          <>
            <LabelCell>{tr('unnestIndexCol')}</LabelCell>
            <SegmentCells
              value={hasIndexColumn ? 'on' : 'off'}
              ariaLabel={tr('unnestIndexCol')}
              options={[
                { value: 'off', label: tr('unnestNoIndex') },
                { value: 'on', label: tr('unnestGenerateIndex') },
              ]}
              onChange={(value) =>
                updateConfig((cfg) => ({
                  ...cfg,
                  withIndex: value === 'on' ? 'idx' : undefined,
                }))
              }
            />
            <Cell v={['ctl', indexMissing && 'err']}>
              <GlassCommitTextInput
                value={withIndex ?? ''}
                disabled={!hasIndexColumn}
                onCommit={(v) => updateConfig((cfg) => ({ ...cfg, withIndex: v.trim() }))}
                placeholder={tr('unnestIndexPlaceholder')}
                ariaLabel={tr('unnestIndexCol')}
                ariaInvalid={indexMissing}
              />
            </Cell>
            {indexMissing ? (
              <>
                <Cell v={['lab']} />
                <ErrorRow span={3}>{tr('unnestIndexRequired')}</ErrorRow>
              </>
            ) : null}

            <LabelCell>{tr('unnestOutputHeader')}</LabelCell>
            <Cell span={2}>
              <label className="flex cursor-pointer items-center gap-2 select-none">
                <input
                  type="checkbox"
                  checked={keepParentNames}
                  onChange={(e) =>
                    updateConfig((cfg) => ({ ...cfg, keepParentNames: e.target.checked }))
                  }
                  className="opg-cbx"
                />
                {tr('unnestKeepParent')}
              </label>
            </Cell>
            <Cell>
              <label className="flex cursor-pointer items-center gap-2 select-none">
                <input
                  type="checkbox"
                  checked={preserveOrder}
                  onChange={(e) =>
                    updateConfig((cfg) => ({ ...cfg, preserveOrder: e.target.checked }))
                  }
                  className="opg-cbx"
                />
                {tr('unnestPreserveOrder')}
              </label>
            </Cell>
          </>
        ) : null}
      </FormGrid>
    </FormScroll>
  );
}
