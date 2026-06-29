import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, X } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFormLabel } from './shared/GlassFormLabel';
import { GlassFormTextInput } from './shared/GlassFormTextInput';
import { GlassFieldSelector } from './shared/GlassFieldSelector';

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

  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!taskId || !sourceNode?.id) return;
    const api = window.electronAPI?.data;
    if (!api?.getWorkflowNodeColumnTypes) return;
    api
      .getWorkflowNodeColumnTypes({
        taskId,
        nodeId: sourceNode.id,
        nodeType: sourceNode.type as never,
        nodeConfig: (sourceNode.config ?? {}) as Record<string, unknown>,
      })
      .then((types) => {
        const map: Record<string, string> = {};
        for (const t of types) map[t.name] = t.type;
        setColumnTypes(map);
      })
      .catch(() => setColumnTypes({}));
  }, [taskId, sourceNode?.id, sourceNode?.type, sourceNode?.config]);

  const updateConfig = useCallback(
    (updater: (config: Record<string, unknown>) => Record<string, unknown>) => {
      onNodeChange((current) => ({
        ...current,
        config: updater(current.config),
        updatedAt: Date.now(),
      }));
    },
    [onNodeChange]
  );

  const columns: string[] = (node.config.columns as string[]) ?? [];
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

  const [columnsOpen, setColumnsOpen] = useState(false);

  function TagBar({
    items,
    onRemove,
    onClear,
    open,
    onToggle,
  }: {
    items: string[];
    onRemove: (col: string) => void;
    onClear: () => void;
    open: boolean;
    onToggle: () => void;
  }) {
    return (
      <div className="rounded border border-border-muted bg-background/60 px-2 py-1 overflow-hidden">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onClear}
            className="inline-flex flex-shrink-0 items-center justify-center rounded px-1 text-text-muted hover:text-error hover:bg-error/10 transition-colors"
            title={tr('clearAll', '清空字段')}
            aria-label={tr('clearAll', '清空字段')}
          >
            <Trash2 className="h-3 w-3" />
          </button>
          {items.length === 0 && (
            <span className="text-[11px] text-text-muted italic">
              {tr('noFieldsSelected', '暂未选择字段')}
            </span>
          )}
          <div className="flex flex-1 flex-wrap gap-1">
            {items.map((col) => (
              <span
                key={col}
                className="inline-flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent"
              >
                {col}
                <button
                  type="button"
                  onClick={() => onRemove(col)}
                  className="inline-flex h-3 w-3 items-center justify-center rounded-full hover:bg-accent/20 transition-colors"
                  aria-label={tr('removeField', '移除字段')}
                >
                  <X className="h-2 w-2" />
                </button>
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex flex-shrink-0 items-center justify-center rounded px-1.5 py-0.5 text-[11px] text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            {open ? '收起 ▲' : '展开 ▼'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid content-start gap-2.5">
      {/* ═══ 步骤1: 列展开 ═══ */}
      <div className="rounded-lg border border-border-muted bg-background/42">
        <div className="flex items-end gap-3 px-3 pt-2.5 pb-1.5">
          <span className="h-8 w-8 rounded-full bg-accent/20 text-[14px] font-bold text-accent flex items-center justify-center leading-none">
            1
          </span>
          <div className="grid">
            <span className="text-[13px] font-semibold text-text-primary">
              {tr('unpivotMode', '列展开')}
            </span>
            <span className="text-[10px] text-text-muted">
              {tr('unpivotConfigHint', '选择要展开的列与输出名称')}
            </span>
          </div>
        </div>
        <div className="px-3 pb-3 grid gap-2.5">
          <div className="grid gap-1">
            <GlassFormLabel>{tr('unpivotExpandCols', '要展开的列')}</GlassFormLabel>
            <TagBar
              items={columns}
              onRemove={removeColumn}
              onClear={clearColumns}
              open={columnsOpen}
              onToggle={() => setColumnsOpen((v) => !v)}
            />
            {columnsOpen && (
              <GlassFieldSelector
                columns={fieldCompletions}
                selected={columns}
                onChange={handleColumnsSelect}
                columnTypes={columnTypes}
                maxHeight="180px"
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <GlassFormLabel>{tr('unpivotNameCol', '名称列')}</GlassFormLabel>
              <GlassFormTextInput
                value={nameColumn}
                onChange={(v) => updateConfig((cfg) => ({ ...cfg, nameColumn: v || undefined }))}
                placeholder="name"
                className="w-full"
                style={{ height: '1.75rem' }}
              />
            </div>
            <div className="grid gap-1">
              <GlassFormLabel>{tr('unpivotValueCol', '值列')}</GlassFormLabel>
              <GlassFormTextInput
                value={valueColumn}
                onChange={(v) => updateConfig((cfg) => ({ ...cfg, valueColumn: v || undefined }))}
                placeholder="value"
                className="w-full"
                style={{ height: '1.75rem' }}
              />
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text-secondary">
            <input
              type="checkbox"
              checked={includeNulls}
              onChange={(e) =>
                updateConfig((cfg) => ({
                  ...cfg,
                  includeNulls: e.target.checked || undefined,
                }))
              }
              className="h-3.5 w-3.5 rounded border-border-muted accent-accent"
            />
            {tr('unpivotIncludeNulls', '包含空值行')}
          </label>
        </div>
      </div>
    </div>
  );
}
