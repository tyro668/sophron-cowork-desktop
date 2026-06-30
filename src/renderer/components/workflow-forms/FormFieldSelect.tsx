import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { OperatorFormProps } from './index';
import { GlassFieldSelector } from './shared/GlassFieldSelector';

export default function FormFieldSelect({
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

  const commitColumns = useCallback(
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
    (col: string) => {
      commitColumns(columns.filter((c) => c !== col));
    },
    [columns, commitColumns]
  );

  const clearAll = useCallback(() => {
    commitColumns([]);
  }, [commitColumns]);

  return (
    <div className="flex flex-col min-h-0 overflow-hidden" style={{ height: '100%' }}>
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {/* Title bar */}
        <div className="flex items-center justify-between py-1.5">
          <span className="text-[12px] text-text-muted">
            {tr('fieldSelectCount', '已选 {{n}}/{{total}} 个字段')
              .replace('{{n}}', String(columns.length))
              .replace('{{total}}', String(fieldCompletions.length))}
          </span>
          <div className="flex items-center gap-2">
            {columns.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="text-[12px] text-text-muted hover:text-error transition-colors"
              >
                {tr('clearAll', '清空')}
              </button>
            )}
          </div>
        </div>

        {/* Dual-pane layout */}
        <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
          {/* Left: field library */}
          <GlassFieldSelector
            columns={fieldCompletions}
            selected={columns}
            onChange={commitColumns}
            columnTypes={columnTypes}
            maxHeight="none"
          />

          {/* Right: selected fields */}
          <div className="flex min-h-0 flex-col rounded-lg border border-border-subtle bg-background/24">
            <div className="flex items-center justify-between border-b border-border-subtle px-2.5 py-1.5">
              <span className="text-[12px] font-medium text-text-secondary">
                {tr('selectedFields', '已选字段')}
              </span>
              <span className="text-[10px] text-text-muted">{columns.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-1.5">
              {columns.length === 0 ? (
                <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                  {tr('noFieldsSelected', '暂未选择字段')}
                </div>
              ) : (
                <div className="flex flex-wrap content-start gap-1">
                  {columns.map((col) => (
                    <span
                      key={col}
                      className="inline-flex items-center gap-0.5 rounded bg-accent/10 px-1.5 py-0.5 text-[12px] font-medium text-accent"
                    >
                      {col}
                      <button
                        type="button"
                        onClick={() => removeColumn(col)}
                        className="ml-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full hover:bg-accent/20"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
