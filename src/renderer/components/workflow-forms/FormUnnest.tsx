import { useEffect, useState } from 'react';
import type { OperatorFormProps } from './index';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassFieldSingleSelect } from './shared/GlassFieldSingleSelect';
import { GlassSegmentedControl } from './shared/GlassSegmentedControl';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';

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

  const sourceKind = (node.config.sourceKind as 'list' | 'json') ?? 'list';
  const field = (node.config.column as string) ?? '';
  const path = (node.config.path as string) ?? '$';
  const withIndex = node.config.withIndex as string | undefined;
  const keepParentNames = !!node.config.keepParentNames;
  const preserveOrder = !!node.config.preserveOrder;
  const isListMode = sourceKind === 'list';
  const hasIndexColumn = typeof withIndex === 'string' && withIndex.length > 0;

  const [localAlias, setLocalAlias] = useState((node.config.alias as string) ?? '');
  const [localPath, setLocalPath] = useState(path);
  const [localIndex, setLocalIndex] = useState(withIndex ?? '');

  useEffect(() => {
    setLocalAlias((node.config.alias as string) ?? '');
    setLocalPath(path);
    setLocalIndex(withIndex ?? '');
  }, [node.config.alias, path, withIndex]);

  return (
    <div className="scrollbar-hover flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-3">
      <div className="flex items-center gap-2">
        <GlassFormLabel>{tr('unnestSourceType')}</GlassFormLabel>
        <GlassSegmentedControl
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
          onChange={(value) =>
            updateConfig((cfg) => ({ ...cfg, sourceKind: value as 'list' | 'json' }))
          }
          ariaLabel={tr('unnestSourceType')}
        />
      </div>

      <div className="flex items-center gap-2">
        <GlassFormLabel>{tr('unnestSourceField')}</GlassFormLabel>
        <GlassFieldSingleSelect
          value={field}
          options={fieldCompletions}
          columnTypes={columnTypes}
          onChange={(v) => updateConfig((cfg) => ({ ...cfg, column: v }))}
          placeholder={tr('unnestSelectField')}
          searchPlaceholder={tr('fieldPicker.searchField')}
          emptyText={tr('fieldPicker.noMatch')}
          className="h-9 flex-1"
        />
      </div>

      {isListMode && (
        <div className="flex items-center gap-2">
          <GlassFormLabel>{tr('unnestAlias')}</GlassFormLabel>
          <GlassFormTextInput
            value={localAlias}
            onChange={(v) => {
              setLocalAlias(v);
              const value = v.trim();
              if (value.length > 0) {
                updateConfig((cfg) => ({ ...cfg, alias: value }));
              }
            }}
            placeholder={tr('unnestAliasPlaceholder')}
            className="h-9 w-60 rounded-md px-2"
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <GlassFormLabel>{tr('unnestPathLabel')}</GlassFormLabel>
        <GlassFormTextInput
          value={localPath}
          onChange={(v) => {
            setLocalPath(v);
            updateConfig((cfg) => ({ ...cfg, path: v }));
          }}
          placeholder={tr('unnestPathPlaceholder')}
          className="h-9 w-60 rounded-md px-2"
        />
      </div>

      {isListMode && (
        <div className="flex items-center gap-2">
          <GlassFormLabel>{tr('unnestIndexCol')}</GlassFormLabel>
          <label className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 text-[13px] text-text-secondary">
            <input
              type="checkbox"
              checked={hasIndexColumn}
              onChange={(e) => {
                if (e.target.checked) {
                  updateConfig((cfg) => ({ ...cfg, withIndex: localIndex || 'idx' }));
                } else {
                  updateConfig((cfg) => ({ ...cfg, withIndex: undefined }));
                }
              }}
              className="h-3.5 w-3.5 accent-accent"
            />
            {tr('unnestGenerateIndex')}
          </label>
          {hasIndexColumn && (
            <GlassFormTextInput
              value={localIndex}
              onChange={(v) => {
                setLocalIndex(v);
                const value = v.trim();
                if (value.length > 0) {
                  updateConfig((cfg) => ({ ...cfg, withIndex: value }));
                }
              }}
              placeholder={tr('unnestIndexPlaceholder')}
              className="h-9 w-40 rounded-md px-2"
            />
          )}
        </div>
      )}

      {isListMode && (
        <div className="flex items-center gap-2">
          <GlassFormLabel>{tr('unnestOutputHeader')}</GlassFormLabel>
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <label className="flex h-9 cursor-pointer items-center gap-1.5 text-[13px] text-text-secondary">
              <input
                type="checkbox"
                checked={keepParentNames}
                onChange={(e) =>
                  updateConfig((cfg) => ({ ...cfg, keepParentNames: e.target.checked }))
                }
                className="h-3.5 w-3.5 accent-accent"
              />
              {tr('unnestKeepParent')}
            </label>
            <label className="flex h-9 cursor-pointer items-center gap-1.5 text-[13px] text-text-secondary">
              <input
                type="checkbox"
                checked={preserveOrder}
                onChange={(e) =>
                  updateConfig((cfg) => ({ ...cfg, preserveOrder: e.target.checked }))
                }
                className="h-3.5 w-3.5 accent-accent"
              />
              {tr('unnestPreserveOrder')}
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
