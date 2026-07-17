import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OperatorFormProps } from './index';
import { GlassTagBar } from './shared/GlassTagBar';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassFieldMultiSelect } from './shared/GlassFieldMultiSelect';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { useWorkflowNodeColumnTypes } from '../../hooks/useWorkflowNodeColumnTypes';

export default function FormUnpivot({
  node,
  taskId,
  fieldCompletions,
  sourceNode,
  onNodeChange,
}: OperatorFormProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

  const columnTypes = useWorkflowNodeColumnTypes({ taskId, sourceNode });
  const updateConfig = useUpdateConfig(onNodeChange);

  const columns = useMemo(() => (node.config.columns as string[]) ?? [], [node.config?.columns]);
  const nameColumn = String(node.config.nameColumn ?? '');
  const valueColumn = String(node.config.valueColumn ?? '');
  const includeNulls = Boolean(node.config.includeNulls ?? false);

  const handleColumnsSelect = useCallback(
    (next: string[]) => {
      updateConfig((cfg) => ({ ...cfg, columns: next.length > 0 ? next : undefined }));
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
      <div className="flex-[4] rounded-lg border border-border-muted bg-background/42 content-start">
        <div className="flex items-end gap-3 px-3 pt-2.5 pb-1.5">
          <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
            1
          </span>
          <div className="grid">
            <span className="text-[13px] font-semibold text-text-primary">
              {tr('unpivotMode', '列展开')}
            </span>
            <span className="text-[10px] text-text-muted">
              {tr('unpivotConfigHint', '选择要展开的列')}
            </span>
          </div>
        </div>
        <div className="px-3 pb-3 grid gap-2.5">
          <div className="grid gap-1">
            <span className="mb-1 block text-[12px] font-medium text-text-secondary">
              {tr('unpivotExpandCols', '要展开的列')}
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
              placeholder={tr('noFieldsSelected', '暂未选择字段')}
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
      </div>

      {/* ═══ 右列: 输出配置 ═══ */}
      <div className="flex-[6] rounded-lg border border-border-muted bg-background/42 content-start">
        <div className="flex items-end gap-3 px-3 pt-2.5 pb-1.5">
          <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
            2
          </span>
          <div className="grid">
            <span className="text-[13px] font-semibold text-text-primary">
              {tr('unpivotOutput', '输出配置')}
            </span>
            <span className="text-[10px] text-text-muted">
              {tr('unpivotOutputHint', '自定义输出列名与空值处理')}
            </span>
          </div>
        </div>
        <div className="px-3 pb-3 grid gap-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <span className="mb-1 block text-[12px] font-medium text-text-secondary">
                {tr('unpivotNameCol', '名称列')}
                <span
                  className="text-[10px] text-text-muted ml-1"
                  title={tr('unpivotNameColTip', '新列的列名，存放原字段的名称')}
                >
                  (可选)
                </span>
              </span>
              <GlassFormTextInput
                value={nameColumn}
                onChange={(v) => updateConfig((cfg) => ({ ...cfg, nameColumn: v || undefined }))}
                placeholder={tr('unpivotNameColPlaceholder', '请输入字段名')}
                className="h-7 text-[13px] w-full"
              />
            </div>
            <div className="grid gap-1">
              <span className="mb-1 block text-[12px] font-medium text-text-secondary">
                {tr('unpivotValueCol', '值列')}
                <span
                  className="text-[10px] text-text-muted ml-1"
                  title={tr('unpivotValueColTip', '新列的列名，存放原字段的值')}
                >
                  (可选)
                </span>
              </span>
              <GlassFormTextInput
                value={valueColumn}
                onChange={(v) => updateConfig((cfg) => ({ ...cfg, valueColumn: v || undefined }))}
                placeholder={tr('unpivotValueColPlaceholder', '请输入字段名')}
                className="h-7 text-[13px] w-full"
              />
            </div>
          </div>

          <label
            className="flex cursor-pointer items-center gap-2 text-[12px] text-text-secondary"
            title={tr('unpivotIncludeNullsTip', '勾选后，空值也会生成对应行')}
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
            {tr('unpivotIncludeNulls', '包含空值行')}
          </label>
        </div>
      </div>
    </div>
  );
}
