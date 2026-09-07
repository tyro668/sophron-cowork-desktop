import { useCallback, useMemo } from 'react';
import type { OperatorFormProps } from './index';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassFieldCompactSelect } from './shared/GlassFieldCompactSelect';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';

export default function FormUnpivot({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('unpivot');
  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });
  const updateConfig = useUpdateConfig(onNodeChange);

  const columns = useMemo(() => {
    const raw = (node.config.columns as string[]) ?? [];
    if (node.config?.mode === 'except') {
      return fieldCompletions.filter((c) => !raw.includes(c));
    }
    return raw;
  }, [node.config?.columns, node.config?.mode, fieldCompletions]);
  const nameColumn = String(node.config.nameColumn ?? '');
  const valueColumn = String(node.config.valueColumn ?? '');
  const includeNulls = Boolean(node.config.includeNulls ?? false);

  const handleColumnsSelect = useCallback(
    (next: string[]) => {
      updateConfig((cfg) => ({
        ...cfg,
        mode: 'include',
        columns: next.length > 0 ? next : undefined,
      }));
    },
    [updateConfig]
  );

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="flex min-h-0 min-w-0 w-full flex-1 gap-2.5">
        {/* ═══ 左列: 列展开 ═══ */}
        <section className="operator-section flex-[4] content-start flex min-h-0 min-w-0 w-0 flex-col">
          <div className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col px-3 pb-3">
            <div className="mb-3 px-0.5 pt-1">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                {tr('unpivotDimensionsLabel')}
              </div>
              <p className="mt-1 text-[12px] leading-5 text-text-muted">
                {tr('unpivotDimensionsHint')}
              </p>
            </div>
            <GlassFieldCompactSelect
              columns={fieldCompletions}
              selected={columns}
              onChange={handleColumnsSelect}
              columnTypes={columnTypes}
              maxHeight="none"
            />
          </div>
        </section>

        {/* ═══ 右列: 输出配置 ═══ */}
        <section className="operator-section flex-[6] content-start flex min-h-0 min-w-0 w-0 flex-col">
          <div className="scrollbar-hover flex-1 min-h-0 overflow-y-auto border-l border-border-subtle/70 pl-3 pr-3 pb-3 grid content-start gap-3">
            <div className="px-0.5 pt-1">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
                <span className="h-2 w-2 rounded-full bg-accent" />
                {tr('unpivotOutputLabel')}
              </div>
              <p className="mt-1 text-[12px] leading-5 text-text-muted">
                {tr('unpivotOutputHint')}
              </p>
            </div>
            <div className="grid gap-2">
              <div className="flex items-center gap-4">
                <GlassFormLabel>{tr('unpivotNameCol')}</GlassFormLabel>
                <GlassFormTextInput
                  value={nameColumn}
                  onChange={(v) => updateConfig((cfg) => ({ ...cfg, nameColumn: v || undefined }))}
                  placeholder={tr('unpivotNameColPlaceholder')}
                  className="h-8 w-60 shrink-0 text-[13px]"
                />
              </div>
              <div className="flex items-center gap-4">
                <GlassFormLabel>{tr('unpivotValueCol')}</GlassFormLabel>
                <GlassFormTextInput
                  value={valueColumn}
                  onChange={(v) => updateConfig((cfg) => ({ ...cfg, valueColumn: v || undefined }))}
                  placeholder={tr('unpivotValueColPlaceholder')}
                  className="h-8 w-60 shrink-0 text-[13px]"
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <GlassFormLabel>{tr('unpivotNullsLabel')}</GlassFormLabel>
              <label
                className="flex cursor-pointer items-center gap-2 text-[13px] text-text-secondary"
                title={tr('unpivotIncludeNullsTip')}
              >
                <input
                  type="checkbox"
                  checked={includeNulls}
                  onChange={(e) => {
                    const v = e.target.checked;
                    updateConfig((cfg) => ({
                      ...cfg,
                      includeNulls: v || undefined,
                    }));
                  }}
                  className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
                />
                {tr('unpivotIncludeNulls')}
              </label>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
