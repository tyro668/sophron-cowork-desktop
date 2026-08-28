import type { OperatorFormProps } from './index';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassRadioSelect } from './shared/GlassRadioSelect';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';
import { GlassFormLabel } from './shared/GlassFormLabel';

export default function FormUnnest({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('unnest');
  const updateConfig = useUpdateConfig(onNodeChange);
  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });

  const sourceKind = node.config.sourceKind === 'json' ? 'json' : 'list';
  const column = String(node.config.column ?? '');
  const alias = String(node.config.alias ?? '');
  const path = String(node.config.path ?? '');
  const withIndex = String(node.config.withIndex ?? '');
  const keepParentNames = Boolean(node.config.keepParentNames);
  const preserveOrder = Boolean(node.config.preserveOrder);
  const withIndexEnabled = node.config.withIndex !== undefined;
  const isRowMode = sourceKind === 'list';

  function setSourceKind(nextSourceKind: string) {
    updateConfig((cfg) => ({
      ...cfg,
      sourceKind: nextSourceKind,
      ...(nextSourceKind === 'json'
        ? {
            withIndex: undefined,
            keepParentNames: undefined,
            preserveOrder: undefined,
          }
        : {}),
    }));
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="scrollbar-hover flex w-[180px] shrink-0 flex-col overflow-y-auto border-r border-border-muted bg-surface/40 p-3.5">
        <GlassRadioSelect
          value={sourceKind}
          options={[
            {
              value: 'list',
              label: tr('unnestSourceTypeList'),
              tip: tr('unnestSourceTypeListTip'),
            },
            {
              value: 'json',
              label: tr('unnestSourceTypeObject'),
              tip: tr('unnestSourceTypeJsonTip'),
            },
          ]}
          onChange={setSourceKind}
          label={tr('unnestSourceType')}
        />
      </div>

      <div className="scrollbar-hover flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <div className="flex items-center gap-4">
          <GlassFormLabel>{tr('unnestSourceField')}</GlassFormLabel>
          <GlassFieldSingleSelect
            value={column}
            options={fieldCompletions}
            columnTypes={columnTypes}
            onChange={(value) => updateConfig((cfg) => ({ ...cfg, column: value || undefined }))}
            placeholder={tr('unnestSelectField')}
            className="h-8 w-60 shrink-0"
          />
        </div>

        {isRowMode && (
          <div className="flex items-center gap-4">
            <GlassFormLabel>{tr('unnestAlias')}</GlassFormLabel>
            <GlassFormTextInput
              value={alias}
              onChange={(value) => updateConfig((cfg) => ({ ...cfg, alias: value || undefined }))}
              placeholder={tr('unnestAliasPlaceholder')}
              className="h-8 w-60 shrink-0 text-[13px]"
            />
          </div>
        )}

        <div className="flex items-center gap-4">
          <GlassFormLabel>{tr('unnestPathLabel')}</GlassFormLabel>
          <GlassFormTextInput
            value={path}
            onChange={(value) => updateConfig((cfg) => ({ ...cfg, path: value || undefined }))}
            placeholder={tr('unnestPathPlaceholder')}
            className="h-8 w-60 shrink-0 text-[13px]"
          />
        </div>

        {isRowMode && (
          <>
            <div className="flex items-center gap-4">
              <GlassFormLabel>{tr('unnestIndexCol')}</GlassFormLabel>
              <div className="flex items-center gap-3">
                <label className="flex h-8 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap text-[13px] text-text-secondary">
                  <input
                    type="checkbox"
                    checked={withIndexEnabled}
                    onChange={(event) =>
                      updateConfig((cfg) => ({
                        ...cfg,
                        withIndex: event.target.checked ? '' : undefined,
                      }))
                    }
                    className="h-3.5 w-3.5 accent-accent"
                  />
                  {tr('unnestGenerateIndex')}
                </label>
                {withIndexEnabled && (
                  <GlassFormTextInput
                    value={withIndex}
                    onChange={(value) => updateConfig((cfg) => ({ ...cfg, withIndex: value }))}
                    placeholder={tr('unnestIndexPlaceholder')}
                    className="h-8 w-48 shrink-0 text-[13px]"
                  />
                )}
              </div>
            </div>

            <div className="flex items-center gap-4">
              <GlassFormLabel>{tr('unnestOutputHeader')}</GlassFormLabel>
              <div className="flex min-h-8 items-center gap-6">
                <label className="flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap text-[13px] text-text-secondary">
                  <input
                    type="checkbox"
                    checked={keepParentNames}
                    onChange={(event) =>
                      updateConfig((cfg) => ({
                        ...cfg,
                        keepParentNames: event.target.checked || undefined,
                      }))
                    }
                    className="h-3.5 w-3.5 accent-accent"
                  />
                  {tr('unnestKeepParent')}
                </label>
                <label className="flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap text-[13px] text-text-secondary">
                  <input
                    type="checkbox"
                    checked={preserveOrder}
                    onChange={(event) =>
                      updateConfig((cfg) => ({
                        ...cfg,
                        preserveOrder: event.target.checked || undefined,
                      }))
                    }
                    className="h-3.5 w-3.5 accent-accent"
                  />
                  {tr('unnestPreserveOrder')}
                </label>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
