import { useCallback, useMemo, useState } from 'react';
import type { OperatorFormProps } from './index';
import { GlassTagBar } from './shared/GlassTagBar';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassFieldMultiSelect } from './shared/GlassFieldMultiSelect';
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
  const tr = useFormTranslation();
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

  const removeColumn = useCallback(
    (col: string) => handleColumnsSelect(columns.filter((c) => c !== col)),
    [handleColumnsSelect, columns]
  );

  const clearColumns = useCallback(() => handleColumnsSelect([]), [handleColumnsSelect]);

  const [columnsOpen, setColumnsOpen] = useState(true);

  return (
    <div className="flex gap-2.5">
      {/* ═══ 左列: 列展开 ═══ */}
      <section className="operator-section flex-[4] content-start">
        <div className="flex items-end gap-3 px-3 pt-2.5 pb-1.5">
          <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
            1
          </span>
          <div className="grid">
            <span className="text-[13px] font-semibold text-text-primary">{tr('unpivotMode')}</span>
            <span className="text-[10px] text-text-muted">{tr('unpivotConfigHint')}</span>
          </div>
        </div>
        <div className="px-3 pb-3 grid gap-2.5">
          <div className="grid gap-1">
            <span className="mb-1 block text-[12px] font-medium text-text-secondary">
              {tr('unpivotExpandCols')}
            </span>
            <GlassTagBar
              items={columns}
              onRemove={removeColumn}
              onClear={clearColumns}
              open={columnsOpen}
              onToggle={() => setColumnsOpen((v) => !v)}
              toggleStyle="chevron"
              density="default"
              className="min-h-7"
              placeholder={tr('noFieldsSelected')}
            />
            {columnsOpen && (
              <GlassFieldMultiSelect
                columns={fieldCompletions}
                selected={columns}
                onChange={handleColumnsSelect}
                columnTypes={columnTypes}
                maxHeight="180px"
              />
            )}
          </div>
        </div>
      </section>

      {/* ═══ 右列: 输出配置 ═══ */}
      <section className="operator-section flex-[6] content-start border-l border-border-subtle/70">
        <div className="flex items-end gap-3 px-3 pt-2.5 pb-1.5">
          <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
            2
          </span>
          <div className="grid">
            <span className="text-[13px] font-semibold text-text-primary">
              {tr('unpivotOutput')}
            </span>
            <span className="text-[10px] text-text-muted">{tr('unpivotOutputHint')}</span>
          </div>
        </div>
        <div className="px-3 pb-3 grid gap-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <span className="mb-1 block text-[12px] font-medium text-text-secondary">
                {tr('unpivotNameCol')}
                <span className="text-[10px] text-text-muted ml-1" title={tr('unpivotNameColTip')}>
                  ({tr('optional')})
                </span>
              </span>
              <GlassFormTextInput
                value={nameColumn}
                onChange={(v) => updateConfig((cfg) => ({ ...cfg, nameColumn: v || undefined }))}
                placeholder={tr('unpivotNameColPlaceholder')}
                className="h-7 text-[13px] w-full"
              />
            </div>
            <div className="grid gap-1">
              <span className="mb-1 block text-[12px] font-medium text-text-secondary">
                {tr('unpivotValueCol')}
                <span className="text-[10px] text-text-muted ml-1" title={tr('unpivotValueColTip')}>
                  ({tr('optional')})
                </span>
              </span>
              <GlassFormTextInput
                value={valueColumn}
                onChange={(v) => updateConfig((cfg) => ({ ...cfg, valueColumn: v || undefined }))}
                placeholder={tr('unpivotValueColPlaceholder')}
                className="h-7 text-[13px] w-full"
              />
            </div>
          </div>

          <label
            className="flex cursor-pointer items-center gap-2 text-[12px] text-text-secondary"
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
      </section>
    </div>
  );
}
